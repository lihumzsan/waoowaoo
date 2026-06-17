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
  collectPanelReferenceImageItemsWithDiagnostics,
  normalizeReferenceImageItemsForGeneration,
  parsePanelCharacterReferences,
  type NumberedReferenceImage,
  type ReferenceImageItem,
  resolveNovelData,
} from './image-task-handler-shared'
import { buildPanelGridPrompt } from './panel-image-prompt'
import {
  normalizeReferenceImagesForGeneration,
  type OutboundImageNormalizationIssue,
} from '@/lib/media/outbound-image'
import {
  appendStyleBiblePromptBlock,
  resolveEditScriptStyleBibleForStoryboardTask,
} from '@/lib/edit-script/style-bible-prompt'
import {
  applyGridPromptFieldOmissions,
  parseStoryboardPromptFieldOmissions,
} from '@/lib/storyboard/prompt-field-selection'

const GRID_CELL_COUNT = 4
const GRID_TEXT_LIMIT = 520
const GRID_JSON_TEXT_LIMIT = 900

type StoryboardGridPayload = {
  mode: '2x2'
  panelIds: string[]
  sourceVideoBlockId: string
}

export type GridPanel = {
  id: string
  storyboardId: string
  panelIndex: number
  shotType: string | null
  cameraMove: string | null
  description: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  location: string | null
  characters: string | null
  srtSegment: string | null
  photographyRules: string | null
  actingNotes: string | null
  imageUrl: string | null
  imageMediaId: string | null
  previousImageMediaId?: string | null
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

function compactText(value: unknown, maxLength = GRID_TEXT_LIMIT): string | null {
  const normalized = normalizeString(value)
  if (!normalized) return null
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trim()}...`
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
  const raw = normalizeString(value)
  if (!raw) return null
  try {
    return toRecord(JSON.parse(raw))
  } catch {
    return null
  }
}

function compactJsonValue(value: unknown, maxLength = GRID_JSON_TEXT_LIMIT): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string') return compactText(value, maxLength)
  try {
    return compactText(JSON.stringify(value), maxLength)
  } catch {
    return null
  }
}

export function parseStoryboardGridPayload(input: unknown): StoryboardGridPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const mode = normalizeString(record.mode)
  const panelIds = normalizeStringArray(record.panelIds).slice(0, GRID_CELL_COUNT)
  const sourceVideoBlockId = normalizeString(record.sourceVideoBlockId)
  if (mode !== '2x2' || panelIds.length < 2 || !sourceVideoBlockId) return null
  return { mode, panelIds, sourceVideoBlockId }
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

function compactPhotographyRules(raw: string | null): Record<string, string> | null {
  const rules = parseJsonRecord(raw)
  if (!rules) return null
  const consistencyMetadata = toRecord(rules.consistencyMetadata)
  const cameraPlan = toRecord(rules.cameraPlan) || toRecord(consistencyMetadata?.cameraPlan)
  const compact: Record<string, string> = {}
  const shotBlocking = cameraPlan?.shotBlocking ?? rules.shotBlocking
  const entries: Array<[string, unknown]> = [
    ['shot_blocking', shotBlocking],
    ['lighting', rules.lighting],
    ['characters', rules.characters],
    ['depth_of_field', rules.depth_of_field],
    ['color_tone', rules.color_tone],
  ]
  for (const [key, value] of entries) {
    const text = compactJsonValue(value)
    if (text) compact[key] = text
  }
  return Object.keys(compact).length > 0 ? compact : null
}

function compactActingNotes(raw: string | null): string | null {
  const parsed = parseJsonRecord(raw)
  return parsed ? compactJsonValue(parsed) : compactText(raw, GRID_JSON_TEXT_LIMIT)
}

function compactSpatialProfile(value: unknown): Record<string, unknown> | string | null {
  const record = toRecord(value)
  if (!record) return compactJsonValue(value)
  const anchors = Array.isArray(record.anchors)
    ? record.anchors
      .map((anchor) => {
        const item = toRecord(anchor)
        if (!item) return null
        return {
          label: compactText(item.label, 80),
          screenArea: compactText(item.screenArea, 80),
          depthLayer: compactText(item.depthLayer, 80),
          spatialRelations: Array.isArray(item.spatialRelations)
            ? item.spatialRelations
              .map((relation) => compactText(relation, 120))
              .filter((relation): relation is string => Boolean(relation))
              .slice(0, 3)
            : [],
        }
      })
      .filter((anchor): anchor is {
        label: string | null
        screenArea: string | null
        depthLayer: string | null
        spatialRelations: string[]
      } => Boolean(anchor))
      .slice(0, 6)
    : []
  return {
    sceneSummary: compactText(record.sceneSummary),
    anchors,
    depthLayout: compactJsonValue(record.depthLayout),
    lightingDirection: compactText(record.lightingDirection),
  }
}

function resolveCompactLocationReference(input: {
  readonly projectData: Awaited<ReturnType<typeof resolveNovelData>>
  readonly location: string | null
}) {
  if (!input.location) return null
  const matchedLocation = (input.projectData.locations || []).find(
    (item) => item.name.toLowerCase() === input.location!.toLowerCase(),
  )
  if (!matchedLocation) return null
  const selectedImage = (matchedLocation.images || []).find((item) => item.isSelected) || matchedLocation.images?.[0]
  return {
    name: matchedLocation.name,
    description: compactText(selectedImage?.description || null),
    spatial_profile: compactSpatialProfile(selectedImage && 'spatialProfileJson' in selectedImage
      ? selectedImage.spatialProfileJson
      : null),
  }
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
  readonly projectData: Awaited<ReturnType<typeof resolveNovelData>>
}) {
  return {
    cell_index: input.index,
    cell_position: ['top_left', 'top_right', 'bottom_left', 'bottom_right'][input.index],
    panel: {
      panel_id: input.panel.id,
      shot_type: compactText(input.panel.shotType, 120),
      camera_move: compactText(input.panel.cameraMove, 120),
      description: compactText(input.panel.description),
      image_prompt: compactText(input.panel.imagePrompt, 720),
      location: compactText(input.panel.location, 160),
      characters: parsePanelCharacterReferences(input.panel.characters),
      source_text: compactText(input.panel.srtSegment, 320),
      photography_rules: compactPhotographyRules(input.panel.photographyRules),
      acting_notes: compactActingNotes(input.panel.actingNotes),
    },
    panel_context: {
      location_reference: resolveCompactLocationReference({
        projectData: input.projectData,
        location: input.panel.location,
      }),
    },
  }
}

export function buildGridPromptContext(input: {
  readonly panels: readonly GridPanel[]
  readonly projectData: Awaited<ReturnType<typeof resolveNovelData>>
  readonly referenceImageNotes: readonly string[]
  readonly referenceImagesMap: readonly NumberedReferenceImage[]
  readonly sourceVideoBlockId: string
}) {
  return {
    grid: {
      mode: '2x2',
      source_video_block_id: input.sourceVideoBlockId,
      cells: input.panels.map((panel, index) => buildCompactGridCell({
        panel,
        index,
        projectData: input.projectData,
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
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
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
    projectData,
    referenceImageNotes,
    referenceImagesMap,
    sourceVideoBlockId: grid.sourceVideoBlockId,
  })
  const selectedPromptContext = applyGridPromptFieldOmissions(promptContext, promptFieldOmissions)
  const contextJson = JSON.stringify(selectedPromptContext, null, 2)
  const sourceText = promptFieldOmissions.includes('panel.source_text')
    ? ''
    : panels.map((panel) => panel.srtSegment || panel.description || '').filter(Boolean).join('\n')
  const promptBase = buildPanelGridPrompt({
    locale: job.data.locale,
    aspectRatio: projectData.videoRatio,
    sourceText,
    contextJson,
    styleText: '',
  })
  const styleBible = await resolveEditScriptStyleBibleForStoryboardTask({
    projectId: job.data.projectId,
    episodeId: job.data.episodeId,
    storyboardId: panels[0].storyboardId,
  })
  const prompt = promptFieldOmissions.includes('style_bible')
    ? promptBase
    : appendStyleBiblePromptBlock({
      prompt: promptBase,
      styleBible,
      usage: 'storyboardImage',
      locale: job.data.locale,
    })

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
      sourceVideoBlockId: grid.sourceVideoBlockId,
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
      referenceImages: effectiveReferenceImages,
      aspectRatio: projectData.videoRatio,
    },
    allowTaskExternalIdResume: true,
    pollProgress: { start: 30, end: 78 },
  })

  await assertTaskActive(job, 'crop_panel_grid_image')
  const gridBuffer = await loadImageSourceBuffer(source)
  const gridImageUrl = await uploadImageSourceToCos(
    gridBuffer,
    'panel-grid',
    `${grid.sourceVideoBlockId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${panels[0].id}`,
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
          previousImageUrl: panel.imageUrl || null,
          previousImageMediaId: panel.imageMediaId || null,
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
