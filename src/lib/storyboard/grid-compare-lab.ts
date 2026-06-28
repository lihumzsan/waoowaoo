import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { readProjectEditScript } from '@/lib/edit-script/service'
import type { EditGenerationSegment } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  buildImageBillingPayload,
  getProjectModelConfig,
} from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { locales, type Locale } from '@/i18n/routing'
import { parseStoryboardPromptFieldOmissions, type StoryboardPromptFieldId } from '@/lib/storyboard/prompt-field-selection'

export type StoryboardGridCompareMode = 'single_parallel' | 'grid_2x2'

export type StoryboardGridComparePanel = {
  readonly id: string
  readonly panelIndex: number
  readonly panelNumber: number | null
  readonly shotType: string | null
  readonly cameraMove: string | null
  readonly description: string | null
  readonly location: string | null
  readonly imagePrompt: string | null
  readonly imageUrl: string | null
}

export type StoryboardGridCompareBlock = {
  readonly segmentIndex: number
  readonly sourceGenerationSegmentId: string
  readonly kind: 'group'
  readonly shotNumbers: readonly number[]
  readonly continuity: string
  readonly panels: readonly StoryboardGridComparePanel[]
}

export type StoryboardGridCompareSource = {
  readonly editScriptId: string
  readonly episodeId: string
  readonly blocks: readonly StoryboardGridCompareBlock[]
}

type CompareSubmitInput = {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceGenerationSegmentId: string
  readonly panelIds: readonly string[]
  readonly mode: StoryboardGridCompareMode
  readonly locale: Locale
  readonly omittedFields: readonly StoryboardPromptFieldId[]
  readonly previousGridImageUrl?: string | null
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((item) => normalizeString(item))
    .filter(Boolean)))
}

function panelShotNumber(panel: { readonly panelNumber: number | null; readonly panelIndex: number }): number {
  return panel.panelNumber ?? panel.panelIndex + 1
}

function buildSourceGenerationSegmentId(editScriptId: string, segmentIndex: number): string {
  return `${editScriptId}:generationSegment:${segmentIndex + 1}`
}

export function parseStoryboardGridCompareSubmitBody(value: unknown): {
  readonly episodeId: string
  readonly sourceGenerationSegmentId: string
  readonly panelIds: readonly string[]
  readonly mode: StoryboardGridCompareMode
  readonly locale: Locale
  readonly omittedFields: readonly StoryboardPromptFieldId[]
  readonly previousGridImageUrl: string | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS')
  }
  const record = value as Record<string, unknown>
  const episodeId = normalizeString(record.episodeId)
  const sourceGenerationSegmentId = normalizeString(record.sourceGenerationSegmentId)
  const panelIds = normalizeStringArray(record.panelIds).slice(0, 4)
  const mode = normalizeString(record.mode)
  const locale = locales.find((candidate) => candidate === normalizeString(record.locale))
  const omittedFields = parseStoryboardPromptFieldOmissions(record.omittedFields)
  const previousGridImageUrl = normalizeString(record.previousGridImageUrl) || null
  if (!episodeId || !sourceGenerationSegmentId || panelIds.length < 2) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (mode !== 'single_parallel' && mode !== 'grid_2x2') {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!locale) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TASK_LOCALE_REQUIRED',
      field: 'locale',
    })
  }
  return { episodeId, sourceGenerationSegmentId, panelIds, mode, locale, omittedFields, previousGridImageUrl }
}

export async function getStoryboardGridCompareSource(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<StoryboardGridCompareSource> {
  const editScript = await readProjectEditScript({
    projectId: input.projectId,
    episodeId: input.episodeId,
  })
  if (!editScript?.id) throw new ApiError('NOT_FOUND')
  const editScriptId = editScript.id

  const storyboards = await prisma.projectStoryboard.findMany({
    where: {
      episodeId: input.episodeId,
      episode: {
        projectId: input.projectId,
      },
    },
    select: {
      id: true,
      panels: {
        orderBy: { panelIndex: 'asc' },
        select: {
          id: true,
          panelIndex: true,
          panelNumber: true,
          shotType: true,
          cameraMove: true,
          description: true,
          location: true,
          imagePrompt: true,
          imageUrl: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const panelsByShotNumber = new Map<number, StoryboardGridComparePanel>()
  for (const storyboard of storyboards) {
    void storyboard.id
    for (const panel of storyboard.panels) {
      panelsByShotNumber.set(panelShotNumber(panel), panel)
    }
  }

  const blocks = editScript.generationSegments
    .map((segment: EditGenerationSegment, index): StoryboardGridCompareBlock => ({
      segmentIndex: index,
      sourceGenerationSegmentId: buildSourceGenerationSegmentId(editScriptId, index),
      kind: 'group',
      shotNumbers: segment.shotNumbers,
      continuity: segment.continuity,
      panels: segment.shotNumbers
        .map((shotNumber) => panelsByShotNumber.get(shotNumber))
        .filter((panel): panel is StoryboardGridComparePanel => Boolean(panel))
        .slice(0, 4),
    }))
    .filter((block) => block.panels.length >= 2)

  return {
    editScriptId,
    episodeId: input.episodeId,
    blocks,
  }
}

async function assertComparePanels(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly panelIds: readonly string[]
}) {
  const panels = await prisma.projectPanel.findMany({
    where: {
      id: { in: [...input.panelIds] },
      storyboard: {
        episodeId: input.episodeId,
        episode: {
          projectId: input.projectId,
        },
      },
    },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      imageUrl: true,
      imageMediaId: true,
    },
  })
  const panelsById = new Map(panels.map((panel) => [panel.id, panel]))
  const orderedPanels = input.panelIds.map((panelId) => panelsById.get(panelId))
  const missingPanelIds = input.panelIds.filter((panelId, index) => !orderedPanels[index])
  if (missingPanelIds.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_GRID_COMPARE_PANEL_NOT_FOUND',
      message: missingPanelIds.join(','),
    })
  }
  const foundPanels = orderedPanels.filter((panel): panel is NonNullable<typeof panel> => Boolean(panel))
  const storyboardIds = new Set(foundPanels.map((panel) => panel.storyboardId))
  if (storyboardIds.size !== 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_GRID_COMPARE_STORYBOARD_MISMATCH',
    })
  }
  return foundPanels
}

async function buildCompareBillingPayload(input: {
  readonly projectId: string
  readonly userId: string
  readonly body: Record<string, unknown>
}) {
  const modelConfig = await getProjectModelConfig(input.projectId, input.userId)
  if (!modelConfig.storyboardModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_NOT_CONFIGURED',
    })
  }
  await resolveModelSelection(input.userId, modelConfig.storyboardModel, 'image')
  return buildImageBillingPayload({
    projectId: input.projectId,
    userId: input.userId,
    imageModel: modelConfig.storyboardModel,
    basePayload: input.body,
    aspectRatio: modelConfig.videoRatio,
  })
}

function serialReferenceNote(locale: Locale): string {
  return locale === 'en'
    ? 'Previous complete 2x2 storyboard grid. Use it only as continuity reference for character identity, spatial axis, lighting direction, composition relationship, and scene consistency. Do not copy its exact actions or layout; generate the current block from the current cells.'
    : '上一张完整 2x2 分镜套图。仅用于参考角色一致性、空间轴线、光线方向、构图关系和场景连续性；不要复制上一张的具体动作或布局，必须按当前四格内容生成。'
}

export async function submitStoryboardGridCompareRun(input: CompareSubmitInput) {
  const panelIds = input.panelIds.slice(0, 4)
  const panels = await assertComparePanels({
    projectId: input.projectId,
    episodeId: input.episodeId,
    panelIds,
  })
  const locale = resolveRequiredTaskLocale(input.request, { meta: { locale: input.locale } })

  const tasks = []
  if (input.mode === 'grid_2x2') {
    const body = {
      panelId: panels[0]?.id,
      candidateCount: 1,
      count: 1,
      referenceMode: 'asset',
      compareOnly: true,
      promptFieldOmissions: input.omittedFields,
      ...(input.previousGridImageUrl ? {
        previousGridImageUrl: input.previousGridImageUrl,
        referenceImageNotes: [serialReferenceNote(input.locale)],
      } : {}),
      storyboardGrid: {
        mode: '2x2',
        sourceGenerationSegmentId: input.sourceGenerationSegmentId,
        panelIds,
      },
      meta: { locale },
    }
    const billingPayload = await buildCompareBillingPayload({
      projectId: input.projectId,
      userId: input.userId,
      body,
    })
    const result = await submitOperationTask({
      request: input.request,
      userId: input.userId,
      locale,
      projectId: input.projectId,
      episodeId: input.episodeId,
      type: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: panels[0]?.id || panelIds[0],
      operationId: 'debug_storyboard_grid_compare',
      source: 'storyboard-grid-lab',
      confirmed: true,
      payload: withTaskUiPayload(billingPayload, {
        intent: 'generate',
        hasOutputAtStart: panels.some((panel) => normalizeString(panel.imageUrl) || normalizeString(panel.imageMediaId)),
      }),
      dedupeKey: null,
      billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
      decoratePayload: false,
    })
    tasks.push({
      panelIds,
      taskId: result.taskId,
      status: result.status,
    })
  } else {
    for (const panel of panels) {
      const body = {
        panelId: panel.id,
        candidateCount: 1,
        count: 1,
        referenceMode: 'asset',
        compareOnly: true,
        promptFieldOmissions: input.omittedFields,
        meta: { locale },
      }
      const billingPayload = await buildCompareBillingPayload({
        projectId: input.projectId,
        userId: input.userId,
        body,
      })
      const result = await submitOperationTask({
        request: input.request,
        userId: input.userId,
        locale,
        projectId: input.projectId,
        episodeId: input.episodeId,
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: panel.id,
        operationId: 'debug_storyboard_single_compare',
        source: 'storyboard-grid-lab',
        confirmed: true,
        payload: withTaskUiPayload(billingPayload, {
          intent: 'generate',
          hasOutputAtStart: Boolean(normalizeString(panel.imageUrl) || normalizeString(panel.imageMediaId)),
        }),
        dedupeKey: null,
        billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
        decoratePayload: false,
      })
      tasks.push({
        panelIds: [panel.id],
        taskId: result.taskId,
        status: result.status,
      })
    }
  }

  return {
    success: true,
    mode: input.mode,
    episodeId: input.episodeId,
    sourceGenerationSegmentId: input.sourceGenerationSegmentId,
    omittedFields: input.omittedFields,
    tasks,
  }
}

export function readEpisodeId(value: unknown): string {
  const episodeId = normalizeString(value)
  if (!episodeId) throw new ApiError('INVALID_PARAMS')
  return episodeId
}
