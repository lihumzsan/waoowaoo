import sharp from 'sharp'
import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '../utils'
import {
  AnyObj,
  buildImageProviderRuntimeOptions,
  collectPanelReferenceImageItemsWithDiagnostics,
  normalizeReferenceImageItemsForGeneration,
  type NumberedReferenceImage,
  type ReferenceImageItem,
  resolveNovelData,
} from './image-task-handler-shared'
import {
  normalizeReferenceImagesForGeneration,
  type OutboundImageNormalizationIssue,
} from '@/lib/media/outbound-image'
import {
  applyGridPromptFieldOmissions,
  parseStoryboardPromptFieldOmissions,
} from '@/lib/storyboard/prompt-field-selection'

const GRID_CELL_COUNT = 4

type StoryboardGridPayload = {
  mode: '2x2'
  panelIds: string[]
  sourceGenerationSegmentId: string
}

export type GridPanel = {
  id: string
  storyboardId: string
  panelIndex: number
  panelNumber: number | null
  shotType: string | null
  description: string | null
  imagePrompt: string | null
  location: string | null
  characters: string | null
  srtSegment: string | null
  renderFactsJson: unknown
  actingNotes: string | null
  imageUrl: string | null
  imageMediaId: string | null
}

type GridCellCrop = {
  left: number
  top: number
  width: number
  height: number
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input
    .map((item) => normalizeString(item))
    .filter(Boolean)))
}

export function parseStoryboardGridPayload(input: unknown): StoryboardGridPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const mode = normalizeString(record.mode)
  const panelIds = normalizeStringArray(record.panelIds).slice(0, GRID_CELL_COUNT)
  const sourceGenerationSegmentId = normalizeString(record.sourceGenerationSegmentId)
  if (mode !== '2x2' || panelIds.length < 2 || !sourceGenerationSegmentId) return null
  return { mode, panelIds, sourceGenerationSegmentId }
}

function assertGridPanels(input: {
  readonly panels: readonly GridPanel[]
  readonly grid: StoryboardGridPayload
}): GridPanel[] {
  const byId = new Map(input.panels.map((panel) => [panel.id, panel]))
  const ordered = input.grid.panelIds.map((panelId) => byId.get(panelId))
  const missingPanelIds = input.grid.panelIds.filter((panelId, index) => !ordered[index])
  if (missingPanelIds.length > 0) {
    throw new Error(`PANEL_GRID_TARGET_PANEL_MISSING:${missingPanelIds.join(',')}`)
  }
  const panels = ordered.filter((panel): panel is GridPanel => Boolean(panel))
  const storyboardIds = new Set(panels.map((panel) => panel.storyboardId))
  if (storyboardIds.size !== 1) {
    throw new Error('PANEL_GRID_TARGET_STORYBOARD_MISMATCH')
  }
  return panels
}

function readReferenceImageNotes(payload: AnyObj): string[] {
  return Array.isArray(payload.referenceImageNotes)
    ? payload.referenceImageNotes
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 16)
    : []
}

function readPreviousGridImageUrl(payload: AnyObj): string | null {
  return typeof payload.previousGridImageUrl === 'string' && payload.previousGridImageUrl.trim()
    ? payload.previousGridImageUrl.trim()
    : null
}

async function collectGridReferenceImages(input: {
  readonly projectData: Awaited<ReturnType<typeof resolveNovelData>>
  readonly panels: readonly GridPanel[]
  readonly job: Job<TaskJobData>
}) {
  const referenceImageItems: ReferenceImageItem[] = []
  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  for (const panel of input.panels) {
    const collection = await collectPanelReferenceImageItemsWithDiagnostics(input.projectData, panel, { strict: true })
    referenceImageItems.push(...collection.items)
  }
  const normalized = await normalizeReferenceImageItemsForGeneration(referenceImageItems, {
    locale: input.job.data.locale,
    onIssue: (issue) => {
      normalizationIssues.push(issue)
    },
    context: { taskType: String(input.job.data.type), scope: 'panel-grid-image.refs' },
  })
  if (normalizationIssues.length > 0) {
    throw new Error(`PANEL_GRID_REFERENCE_NORMALIZE_FAILED:${normalizationIssues.map((issue) => `${issue.index}:${issue.code}`).join(';')}`)
  }
  return normalized
}

async function collectPreviousGridReferenceImage(input: {
  readonly payload: AnyObj
  readonly job: Job<TaskJobData>
  readonly nextImageNumber: number
}): Promise<{
  readonly referenceImages: readonly string[]
  readonly referenceImagesMap: readonly NumberedReferenceImage[]
}> {
  const previousGridImageUrl = readPreviousGridImageUrl(input.payload)
  if (!previousGridImageUrl) {
    return { referenceImages: [], referenceImagesMap: [] }
  }
  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const referenceImages = await normalizeReferenceImagesForGeneration([previousGridImageUrl], {
    onIssue: (issue) => {
      normalizationIssues.push(issue)
    },
    context: { taskType: String(input.job.data.type), scope: 'panel-grid-image.previous-grid' },
  })
  if (normalizationIssues.length > 0) {
    throw new Error(`PANEL_GRID_PREVIOUS_REFERENCE_NORMALIZE_FAILED:${normalizationIssues.map((issue) => `${issue.index}:${issue.code}`).join(';')}`)
  }
  return {
    referenceImages,
    referenceImagesMap: referenceImages.map((_, index) => ({
      image_no: input.job.data.locale === 'en'
        ? `Image ${input.nextImageNumber + index + 1}`
        : `图 ${input.nextImageNumber + index + 1}`,
      role: 'extra',
      name: input.job.data.locale === 'en'
        ? 'previous complete storyboard grid'
        : '上一张完整分镜套图',
    })),
  }
}

export function buildCompactGridCell(input: {
  readonly panel: GridPanel
  readonly index: number
}) {
  const imagePrompt = normalizeString(input.panel.imagePrompt)
  if (!imagePrompt) throw new Error(`PANEL_GRID_IMAGE_PROMPT_MISSING:${input.panel.id}`)
  return {
    cell_index: input.index,
    cell_position: ['top_left', 'top_right', 'bottom_left', 'bottom_right'][input.index],
    panel_id: input.panel.id,
    shot_number: input.panel.panelNumber ?? input.panel.panelIndex + 1,
    image_prompt: imagePrompt,
  }
}

export function buildGridPromptContext(input: {
  readonly panels: readonly GridPanel[]
  readonly referenceImageNotes: readonly string[]
  readonly referenceImagesMap: readonly NumberedReferenceImage[]
  readonly sourceGenerationSegmentId: string
}) {
  return {
    grid: {
      mode: '2x2',
      source_generation_segment_id: input.sourceGenerationSegmentId,
      cells: input.panels.map((panel, index) => buildCompactGridCell({
        panel,
        index,
      })),
    },
    context: {
      reference_images: input.referenceImagesMap,
      additional_reference_images: input.referenceImageNotes.map((note, index) => ({
        reference_image_order: index + 1,
        note,
      })),
    },
  }
}

async function loadImageSourceBuffer(source: string | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return source
  const dataUrlMatch = /^data:[^,]*,([\s\S]*)$/.exec(source)
  if (dataUrlMatch) {
    const metadata = source.slice(0, source.indexOf(','))
    const encoded = dataUrlMatch[1] || ''
    return metadata.endsWith(';base64')
      ? Buffer.from(encoded, 'base64')
      : Buffer.from(decodeURIComponent(encoded))
  }
  const response = await fetch(source)
  if (!response.ok) {
    throw new Error(`PANEL_GRID_IMAGE_FETCH_FAILED:${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function buildGridCellCrops(width: number, height: number): GridCellCrop[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error(`PANEL_GRID_IMAGE_SIZE_INVALID:${width}x${height}`)
  }
  const leftWidth = Math.floor(width / 2)
  const rightWidth = width - leftWidth
  const topHeight = Math.floor(height / 2)
  const bottomHeight = height - topHeight
  return [
    { left: 0, top: 0, width: leftWidth, height: topHeight },
    { left: leftWidth, top: 0, width: rightWidth, height: topHeight },
    { left: 0, top: topHeight, width: leftWidth, height: bottomHeight },
    { left: leftWidth, top: topHeight, width: rightWidth, height: bottomHeight },
  ]
}

async function cropGridCells(input: {
  readonly buffer: Buffer
  readonly count: number
}): Promise<Buffer[]> {
  const metadata = await sharp(input.buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) {
    throw new Error('PANEL_GRID_IMAGE_METADATA_MISSING')
  }
  const crops = buildGridCellCrops(width, height).slice(0, input.count)
  const outputs: Buffer[] = []
  for (const crop of crops) {
    outputs.push(await sharp(input.buffer)
      .extract(crop)
      .jpeg({ quality: 95 })
      .toBuffer())
  }
  return outputs
}

export async function handlePanelGridImageTask(
  job: Job<TaskJobData>,
  payload: AnyObj,
  grid: StoryboardGridPayload,
) {
  const promptFieldOmissions = payload.compareOnly === true
    ? parseStoryboardPromptFieldOmissions(payload.promptFieldOmissions)
    : []
  const projectData = await resolveNovelData(job.data.projectId, job.data.userId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const modelKey = modelConfig.storyboardModel
  if (!modelKey) throw new Error('Storyboard model not configured')

  const rawPanels = await prisma.projectPanel.findMany({
    where: { id: { in: grid.panelIds } },
    orderBy: { panelIndex: 'asc' },
  })
  const panels = assertGridPanels({ panels: rawPanels, grid })
  const baseReferences = await collectGridReferenceImages({ projectData, panels, job })
  const previousGridReference = await collectPreviousGridReferenceImage({
    payload,
    job,
    nextImageNumber: baseReferences.referenceImages.length,
  })
  const referenceImages = [
    ...baseReferences.referenceImages,
    ...previousGridReference.referenceImages,
  ]
  const referenceImagesMap = [
    ...baseReferences.referenceImagesMap,
    ...previousGridReference.referenceImagesMap,
  ]
  const referenceImageNotes = readReferenceImageNotes(payload)
  const promptContext = buildGridPromptContext({
    panels,
    referenceImageNotes,
    referenceImagesMap,
    sourceGenerationSegmentId: grid.sourceGenerationSegmentId,
  })
  const selectedPromptContext = applyGridPromptFieldOmissions(promptContext, promptFieldOmissions)
  const contextJson = JSON.stringify(selectedPromptContext, null, 2)
  const sourceText = ''
  const imageRuntimeOptions = buildImageProviderRuntimeOptions({
    generationOptions: payload.generationOptions,
    context: 'panel_grid_image',
  })
  const prompt = [
    'GLOBAL TASK',
    'Generate a 2x2 storyboard grid from the composed final image prompts. Preserve each cell prompt exactly, keep shared scene continuity when the prompts describe the same space, and do not omit hidden, occluded, partial, supporting, or listener characters named in any cell prompt.',
    '',
    contextJson,
  ].join('\n')

  const logger = createScopedLogger({
    module: 'worker.panel-grid-image',
    action: 'panel_grid_image_generate',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
  logger.info({
    message: 'panel grid image prompt resolved',
    details: {
      panelIds: panels.map((panel) => panel.id),
      sourceGenerationSegmentId: grid.sourceGenerationSegmentId,
      promptLength: prompt.length,
      referenceImageCount: referenceImages.length,
    },
  })

  await reportTaskProgress(job, 18, { stage: 'generate_panel_grid' })
  const effectiveReferenceImages = promptFieldOmissions.includes('context.reference_images') ? [] : referenceImages
  const source = await resolveImageSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: modelKey,
    prompt,
    options: {
      ...imageRuntimeOptions,
      referenceImages: effectiveReferenceImages,
    },
    allowTaskExternalIdResume: true,
    pollProgress: { start: 30, end: 78 },
  })

  await assertTaskActive(job, 'crop_panel_grid_image')
  const gridBuffer = await loadImageSourceBuffer(source)
  const gridImageUrl = await uploadImageSourceToCos(
    gridBuffer,
    'panel-grid',
    `${grid.sourceGenerationSegmentId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${panels[0].id}`,
  )
  const cellBuffers = await cropGridCells({ buffer: gridBuffer, count: panels.length })
  const imageUrls: string[] = []
  for (const [index, buffer] of cellBuffers.entries()) {
    const panel = panels[index]
    if (!panel) throw new Error(`PANEL_GRID_CROP_PANEL_MISSING:${index}`)
    imageUrls.push(await uploadImageSourceToCos(buffer, 'panel-candidate', `${panel.id}-grid-${index}`))
  }

  if (payload.compareOnly === true) {
    return {
      panelIds: panels.map((panel) => panel.id),
      candidateCount: imageUrls.length,
      gridImageUrl,
      imageUrls,
      compareOnly: true,
      promptDebug: {
        omittedFields: promptFieldOmissions,
        prompt,
        contextJson,
        sourceText,
        referenceImageCount: effectiveReferenceImages.length,
      },
    }
  }

  await assertTaskActive(job, 'persist_panel_grid_images')
  await prisma.$transaction(async (tx) => {
    for (const [index, panel] of panels.entries()) {
      const imageUrl = imageUrls[index]
      if (!imageUrl) throw new Error(`PANEL_GRID_CROP_OUTPUT_MISSING:${panel.id}`)
      await tx.projectPanel.update({
        where: { id: panel.id },
        data: {
          imageUrl,
          candidateImages: null,
          imageMediaId: null,
        },
      })
    }
  })

  return {
    panelIds: panels.map((panel) => panel.id),
    candidateCount: imageUrls.length,
    gridImageUrl,
    imageUrls,
  }
}
