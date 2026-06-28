import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import type { Locale } from '@/i18n/routing'
import {
  collectPanelReferenceImageItemsWithDiagnostics,
  normalizeReferenceImageItemsForGeneration,
  type ReferenceImageItem,
  resolveNovelData,
} from '@/lib/workers/handlers/image-task-handler-shared'
import {
  buildGridPromptContext,
  type GridPanel,
} from '@/lib/workers/handlers/panel-grid-image-handler'
import {
  applyGridPromptFieldOmissions,
  applyPanelPromptFieldOmissions,
  parseStoryboardPromptFieldOmissions,
  type StoryboardPromptFieldId,
} from '@/lib/storyboard/prompt-field-selection'

export type StoryboardGridComparePromptPreviewInput = {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceGenerationSegmentId: string
  readonly panelIds: readonly string[]
  readonly locale: Locale
  readonly omittedFields: readonly StoryboardPromptFieldId[]
}

export type StoryboardGridComparePromptPreview = {
  readonly omittedFields: readonly StoryboardPromptFieldId[]
  readonly single: readonly StoryboardGridComparePanelPromptPreview[]
  readonly grid: StoryboardGridCompareSinglePromptPreview
}

export type StoryboardGridCompareSinglePromptPreview = {
  readonly prompt: string
  readonly contextJson: string
  readonly sourceText: string
  readonly referenceImageCount: number
}

export type StoryboardGridComparePanelPromptPreview = StoryboardGridCompareSinglePromptPreview & {
  readonly panelId: string
}

type PreviewPanel = GridPanel

function requirePanelPrompt(panel: PreviewPanel): string {
  const prompt = typeof panel.imagePrompt === 'string' ? panel.imagePrompt.trim() : ''
  if (!prompt) throw new ApiError('INVALID_PARAMS', { code: 'STORYBOARD_GRID_COMPARE_PANEL_PROMPT_MISSING' })
  return prompt
}

function requirePanelRenderFacts(panel: PreviewPanel): unknown {
  if (panel.renderFactsJson === null || panel.renderFactsJson === undefined) {
    throw new ApiError('INVALID_PARAMS', { code: 'STORYBOARD_GRID_COMPARE_PANEL_FACTS_MISSING' })
  }
  return panel.renderFactsJson
}

async function collectReferencePreview(input: {
  readonly projectData: Awaited<ReturnType<typeof resolveNovelData>>
  readonly panels: readonly PreviewPanel[]
  readonly locale: Locale
  readonly scope: string
}) {
  const referenceImageItems: ReferenceImageItem[] = []
  for (const panel of input.panels) {
    const collection = await collectPanelReferenceImageItemsWithDiagnostics(input.projectData, panel, { strict: true })
    referenceImageItems.push(...collection.items)
  }
  return await normalizeReferenceImageItemsForGeneration(referenceImageItems, {
    locale: input.locale,
    context: { taskType: 'image_panel', scope: input.scope },
  })
}

function assertPreviewPanels(input: {
  readonly panels: readonly PreviewPanel[]
  readonly panelIds: readonly string[]
}): PreviewPanel[] {
  const byId = new Map(input.panels.map((panel) => [panel.id, panel]))
  const ordered = input.panelIds.map((panelId) => byId.get(panelId))
  const missingPanelIds = input.panelIds.filter((panelId, index) => !ordered[index])
  if (missingPanelIds.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_GRID_COMPARE_PANEL_NOT_FOUND',
      message: missingPanelIds.join(','),
    })
  }
  const panels = ordered.filter((panel): panel is PreviewPanel => Boolean(panel))
  const storyboardIds = new Set(panels.map((panel) => panel.storyboardId))
  if (storyboardIds.size !== 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_GRID_COMPARE_STORYBOARD_MISMATCH',
    })
  }
  return panels
}

async function buildSinglePromptPreview(input: {
  readonly panel: PreviewPanel
  readonly projectData: Awaited<ReturnType<typeof resolveNovelData>>
  readonly locale: Locale
  readonly projectId: string
  readonly episodeId: string
  readonly omittedFields: readonly StoryboardPromptFieldId[]
}): Promise<StoryboardGridComparePanelPromptPreview> {
  const references = await collectReferencePreview({
    projectData: input.projectData,
    panels: [input.panel],
    locale: input.locale,
    scope: 'panel-image.prompt-preview.refs',
  })
  const promptContext = requirePanelRenderFacts(input.panel)
  const contextJson = JSON.stringify(applyPanelPromptFieldOmissions(promptContext, input.omittedFields), null, 2)
  const sourceText = ''
  const prompt = input.omittedFields.length > 0 ? contextJson : requirePanelPrompt(input.panel)
  return {
    panelId: input.panel.id,
    prompt,
    contextJson,
    sourceText,
    referenceImageCount: input.omittedFields.includes('context.reference_images') ? 0 : references.referenceImages.length,
  }
}

async function buildGridPromptPreview(input: {
  readonly panels: readonly PreviewPanel[]
  readonly projectData: Awaited<ReturnType<typeof resolveNovelData>>
  readonly locale: Locale
  readonly sourceGenerationSegmentId: string
  readonly omittedFields: readonly StoryboardPromptFieldId[]
}): Promise<StoryboardGridCompareSinglePromptPreview> {
  const references = await collectReferencePreview({
    projectData: input.projectData,
    panels: input.panels,
    locale: input.locale,
    scope: 'panel-grid-image.prompt-preview.refs',
  })
  const promptContext = buildGridPromptContext({
    panels: input.panels,
    referenceImageNotes: [],
    referenceImagesMap: references.referenceImagesMap,
    sourceGenerationSegmentId: input.sourceGenerationSegmentId,
  })
  const contextJson = JSON.stringify(applyGridPromptFieldOmissions(promptContext, input.omittedFields), null, 2)
  const sourceText = ''
  const prompt = [
    'GLOBAL TASK',
    'Generate a storyboard grid from the structured render facts. Preserve shared scene graph, blocking, character presence, prop continuity, axis, lighting, and per-cell shot deltas.',
    '',
    contextJson,
  ].join('\n')
  return {
    prompt,
    contextJson,
    sourceText,
    referenceImageCount: input.omittedFields.includes('context.reference_images') ? 0 : references.referenceImages.length,
  }
}

export async function buildStoryboardGridComparePromptPreview(
  input: StoryboardGridComparePromptPreviewInput,
): Promise<StoryboardGridComparePromptPreview> {
  const omittedFields = parseStoryboardPromptFieldOmissions(input.omittedFields)
  const projectData = await resolveNovelData(input.projectId, input.userId)
  if (!projectData.videoRatio) throw new ApiError('INVALID_PARAMS', { code: 'PROJECT_VIDEO_RATIO_REQUIRED' })

  const rawPanels = await prisma.projectPanel.findMany({
    where: {
      id: { in: [...input.panelIds] },
      storyboard: {
        episodeId: input.episodeId,
        episode: {
          projectId: input.projectId,
        },
      },
    },
    orderBy: { panelIndex: 'asc' },
  })
  const panels = assertPreviewPanels({ panels: rawPanels, panelIds: input.panelIds.slice(0, 4) })
  const single = await Promise.all(panels.map((panel) => buildSinglePromptPreview({
    panel,
    projectData,
    locale: input.locale,
    projectId: input.projectId,
    episodeId: input.episodeId,
    omittedFields,
  })))
  const grid = await buildGridPromptPreview({
    panels,
    projectData,
    locale: input.locale,
    sourceGenerationSegmentId: input.sourceGenerationSegmentId,
    omittedFields,
  })

  return {
    omittedFields,
    single,
    grid,
  }
}
