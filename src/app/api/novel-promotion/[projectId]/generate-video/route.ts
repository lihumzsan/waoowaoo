import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { BillingOperationError } from '@/lib/billing/errors'
import { hasPanelVideoOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { parseModelKeyStrict, type CapabilityValue } from '@/lib/model-config-contract'
import {
  resolveBuiltinCapabilitiesByModelKey,
} from '@/lib/model-capabilities/lookup'
import { resolveBuiltinPricing } from '@/lib/model-pricing/lookup'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import {
  resolvePanelVideoReadinessIssue,
  summarizeVideoReadinessIssues,
  type VideoReadinessPanelLike,
  type VideoReadinessVoiceLine,
} from '@/lib/novel-promotion/video-readiness'
import { parseVideoDurationBinding } from '@/lib/video-duration/audio-binding'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toVideoRuntimeSelections(value: unknown): Record<string, CapabilityValue> {
  if (!isRecord(value)) return {}
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (field === 'aspectRatio') continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      selections[field] = raw
    }
  }
  return selections
}

function resolveVideoGenerationMode(payload: unknown): 'normal' | 'firstlastframe' {
  if (!isRecord(payload)) return 'normal'
  return isRecord(payload.firstLastFrame) ? 'firstlastframe' : 'normal'
}

function isSeedance2Model(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) return false
  return parsed.provider === 'ark'
    && (
      parsed.modelId === 'doubao-seedance-2-0-260128'
      || parsed.modelId === 'doubao-seedance-2-0-fast-260128'
    )
}

function resolveVideoModelKeyFromPayload(payload: Record<string, unknown>): string | null {
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && typeof firstLast.flModel === 'string' && parseModelKeyStrict(firstLast.flModel)) {
    return firstLast.flModel
  }
  if (typeof payload.videoModel === 'string' && parseModelKeyStrict(payload.videoModel)) {
    return payload.videoModel
  }
  return null
}

function requireVideoModelKeyFromPayload(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.videoModel !== 'string' || !parseModelKeyStrict(payload.videoModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_MODEL_REQUIRED',
      field: 'videoModel',
    })
  }
  return payload.videoModel
}

function validateFirstLastFrameModel(input: unknown) {
  if (input === undefined || input === null) return
  if (!isRecord(input)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_PAYLOAD_INVALID',
      field: 'firstLastFrame',
    })
  }

  const flModel = input.flModel
  if (typeof flModel !== 'string' || !parseModelKeyStrict(flModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_MODEL_INVALID',
      field: 'firstLastFrame.flModel',
    })
  }

  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', flModel)
  if (capabilities?.video?.firstlastframe !== true) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_MODEL_UNSUPPORTED',
      field: 'firstLastFrame.flModel',
    })
  }
}

async function validateVideoCapabilityCombination(input: {
  payload: unknown
  projectId: string
  userId: string
}) {
  const payload = input.payload
  if (!isRecord(payload)) return
  const modelKey = resolveVideoModelKeyFromPayload(payload)
  if (!modelKey) return

  // Skip validation for models not in the built-in capability catalog
  const builtinCaps = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  if (!builtinCaps) return

  const runtimeSelections = toVideoRuntimeSelections(payload.generationOptions)
  runtimeSelections.generationMode = resolveVideoGenerationMode(payload)

  let resolvedOptions: Record<string, CapabilityValue>
  try {
    resolvedOptions = await resolveProjectModelCapabilityGenerationOptions({
      projectId: input.projectId,
      userId: input.userId,
      modelType: 'video',
      modelKey,
      runtimeSelections,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
      field: 'generationOptions',
      details: {
        model: modelKey,
        selections: runtimeSelections,
        message,
      },
    })
  }

  const resolution = resolveBuiltinPricing({
    apiType: 'video',
    model: modelKey,
    selections: {
      ...resolvedOptions,
      ...(isSeedance2Model(modelKey) ? { containsVideoInput: false } : {}),
    },
  })
  if (resolution.status === 'missing_capability_match') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
      field: 'generationOptions',
      details: {
        model: modelKey,
        selections: resolvedOptions,
      },
    })
  }
}

function buildVideoPanelBillingInfoOrThrow(payload: unknown) {
  try {
    return buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, isRecord(payload) ? payload : null)
  } catch (error) {
    if (
      error instanceof BillingOperationError
      && (
        error.code === 'BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION'
        || error.code === 'BILLING_UNKNOWN_VIDEO_RESOLUTION'
      )
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
        field: 'generationOptions',
      })
    }
    // Model not in built-in pricing catalog — allow task to proceed;
    // actual billing will be resolved downstream where billing mode is checked.
    if (
      error instanceof BillingOperationError
      && error.code === 'BILLING_UNKNOWN_MODEL'
    ) {
      return null
    }
    throw error
  }
}

type PanelReadinessInput = VideoReadinessPanelLike & {
  id: string
  storyboardId?: string | null
  panelIndex?: number | null
  storyboard?: (VideoReadinessPanelLike['storyboard'] & {
    episodeId?: string | null
  }) | null
}

type LoadedReadinessVoiceLine = VideoReadinessVoiceLine & {
  lineIndex?: number | null
  matchedPanelId?: string | null
  matchedStoryboardId?: string | null
  matchedPanelIndex?: number | null
}

function mergeVoiceLinesById(
  ...lineGroups: Array<VideoReadinessVoiceLine[] | null | undefined>
): VideoReadinessVoiceLine[] {
  const seen = new Set<string>()
  const merged: VideoReadinessVoiceLine[] = []
  for (const lines of lineGroups) {
    for (const line of lines || []) {
      if (!line.id || seen.has(line.id)) continue
      seen.add(line.id)
      merged.push(line)
    }
  }
  return merged
}

function resolveSelectedVoiceLineIds(input: {
  payload?: unknown
  panel: PanelReadinessInput
}): string[] {
  const payloadBinding = isRecord(input.payload)
    ? parseVideoDurationBinding(input.payload.videoDurationBinding)
    : null
  const payloadVoiceLineIds = payloadBinding?.voiceLineIds || []
  if (payloadBinding?.mode === 'match_audio' && payloadVoiceLineIds.length > 0) {
    return payloadVoiceLineIds
  }

  const savedBinding = parseVideoDurationBinding(input.panel.videoDurationBinding)
  const savedVoiceLineIds = savedBinding.voiceLineIds || []
  if (savedBinding.mode === 'match_audio' && savedVoiceLineIds.length > 0) {
    return savedVoiceLineIds
  }
  return []
}

function sortLoadedVoiceLines(lines: LoadedReadinessVoiceLine[]): LoadedReadinessVoiceLine[] {
  return lines.slice().sort((left, right) => (left.lineIndex ?? 0) - (right.lineIndex ?? 0))
}

function stripLoadedVoiceLine(line: LoadedReadinessVoiceLine): VideoReadinessVoiceLine {
  return {
    id: line.id,
    content: line.content,
    audioDuration: line.audioDuration,
  }
}

async function loadExplicitSelectedVoiceLines(
  panel: PanelReadinessInput,
  payload?: unknown,
): Promise<VideoReadinessVoiceLine[]> {
  const episodeId = panel.storyboard?.episodeId
  const selectedVoiceLineIds = resolveSelectedVoiceLineIds({ payload, panel })
  if (!episodeId || selectedVoiceLineIds.length === 0) return []

  return await prisma.novelPromotionVoiceLine.findMany({
    where: {
      id: { in: selectedVoiceLineIds },
      episodeId,
    },
    orderBy: { lineIndex: 'asc' },
    select: {
      id: true,
      content: true,
      audioDuration: true,
    },
  })
}

async function loadRelationVoiceLines(
  panel: PanelReadinessInput,
): Promise<VideoReadinessVoiceLine[]> {
  const episodeId = panel.storyboard?.episodeId
  if (!episodeId) return []

  return await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episodeId,
      matchedPanelId: panel.id,
    },
    orderBy: { lineIndex: 'asc' },
    select: {
      id: true,
      content: true,
      audioDuration: true,
    },
  })
}

async function loadFallbackPanelVoiceLines(
  panel: PanelReadinessInput,
): Promise<VideoReadinessVoiceLine[]> {
  const episodeId = panel.storyboard?.episodeId
  if (
    !episodeId
    || !panel.storyboardId
    || typeof panel.panelIndex !== 'number'
  ) {
    return []
  }

  return await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episodeId,
      matchedPanelId: null,
      matchedStoryboardId: panel.storyboardId,
      matchedPanelIndex: panel.panelIndex,
    },
    orderBy: { lineIndex: 'asc' },
    select: {
      id: true,
      content: true,
      audioDuration: true,
    },
  })
}

async function resolvePanelsReadinessInputs(
  panels: PanelReadinessInput[],
  payload?: unknown,
): Promise<PanelReadinessInput[]> {
  if (panels.length === 0) return []

  const panelIds = panels.map((panel) => panel.id).filter(Boolean)
  const episodeIds = Array.from(new Set(
    panels
      .map((panel) => panel.storyboard?.episodeId)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  ))
  if (episodeIds.length === 0 || panelIds.length === 0) {
    return await Promise.all(panels.map((panel) => resolvePanelReadinessInput(panel, payload)))
  }

  const selectedIdsByPanelId = new Map<string, string[]>()
  const explicitSelectedIds = new Set<string>()
  for (const panel of panels) {
    const selectedIds = resolveSelectedVoiceLineIds({ payload, panel })
    selectedIdsByPanelId.set(panel.id, selectedIds)
    for (const id of selectedIds) explicitSelectedIds.add(id)
  }

  const fallbackPanelFilters = panels
    .filter((panel) => panel.storyboardId && typeof panel.panelIndex === 'number')
    .map((panel) => ({
      matchedStoryboardId: panel.storyboardId!,
      matchedPanelIndex: panel.panelIndex!,
    }))

  const [relationLines, fallbackLines, explicitLines] = await Promise.all([
    prisma.novelPromotionVoiceLine.findMany({
      where: {
        episodeId: { in: episodeIds },
        matchedPanelId: { in: panelIds },
      },
      orderBy: { lineIndex: 'asc' },
      select: {
        id: true,
        content: true,
        audioDuration: true,
        lineIndex: true,
        matchedPanelId: true,
      },
    }),
    fallbackPanelFilters.length > 0
      ? prisma.novelPromotionVoiceLine.findMany({
          where: {
            episodeId: { in: episodeIds },
            matchedPanelId: null,
            OR: fallbackPanelFilters,
          },
          orderBy: { lineIndex: 'asc' },
          select: {
            id: true,
            content: true,
            audioDuration: true,
            lineIndex: true,
            matchedStoryboardId: true,
            matchedPanelIndex: true,
          },
        })
      : Promise.resolve([] as LoadedReadinessVoiceLine[]),
    explicitSelectedIds.size > 0
      ? prisma.novelPromotionVoiceLine.findMany({
          where: {
            id: { in: Array.from(explicitSelectedIds) },
            episodeId: { in: episodeIds },
          },
          orderBy: { lineIndex: 'asc' },
          select: {
            id: true,
            content: true,
            audioDuration: true,
            lineIndex: true,
          },
        })
      : Promise.resolve([] as LoadedReadinessVoiceLine[]),
  ])

  const relationByPanelId = new Map<string, LoadedReadinessVoiceLine[]>()
  for (const line of relationLines) {
    if (!line.matchedPanelId) continue
    const lines = relationByPanelId.get(line.matchedPanelId) || []
    lines.push(line)
    relationByPanelId.set(line.matchedPanelId, lines)
  }

  const fallbackByPanelKey = new Map<string, LoadedReadinessVoiceLine[]>()
  for (const line of fallbackLines) {
    if (!line.matchedStoryboardId || typeof line.matchedPanelIndex !== 'number') continue
    const key = `${line.matchedStoryboardId}:${line.matchedPanelIndex}`
    const lines = fallbackByPanelKey.get(key) || []
    lines.push(line)
    fallbackByPanelKey.set(key, lines)
  }

  const explicitById = new Map(explicitLines.map((line) => [line.id, line]))

  return panels.map((panel) => {
    const selectedIds = selectedIdsByPanelId.get(panel.id) || []
    const explicitSelectedVoiceLines = selectedIds
      .map((id) => explicitById.get(id))
      .filter((line): line is LoadedReadinessVoiceLine => !!line)
      .map(stripLoadedVoiceLine)
    const fallbackKey = panel.storyboardId && typeof panel.panelIndex === 'number'
      ? `${panel.storyboardId}:${panel.panelIndex}`
      : ''

    return {
      ...panel,
      matchedVoiceLines: mergeVoiceLinesById(
        sortLoadedVoiceLines(relationByPanelId.get(panel.id) || []).map(stripLoadedVoiceLine),
        sortLoadedVoiceLines(fallbackByPanelKey.get(fallbackKey) || []).map(stripLoadedVoiceLine),
        explicitSelectedVoiceLines,
      ),
    }
  })
}

async function resolvePanelReadinessInput(
  panel: PanelReadinessInput,
  payload?: unknown,
): Promise<PanelReadinessInput> {
  const [relationVoiceLines, fallbackVoiceLines, explicitSelectedVoiceLines] = await Promise.all([
    loadRelationVoiceLines(panel),
    loadFallbackPanelVoiceLines(panel),
    loadExplicitSelectedVoiceLines(panel, payload),
  ])

  return {
    ...panel,
    matchedVoiceLines: mergeVoiceLinesById(
      relationVoiceLines,
      fallbackVoiceLines,
      explicitSelectedVoiceLines,
    ),
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  requireVideoModelKeyFromPayload(body)
  const locale = resolveRequiredTaskLocale(request, body)
  const isBatch = body?.all === true

  validateFirstLastFrameModel(body?.firstLastFrame)
  await validateVideoCapabilityCombination({
    payload: body,
    projectId,
    userId: session.user.id,
  })

  if (isBatch) {
    const batchModelKey = resolveVideoModelKeyFromPayload(body)
    const batchCapabilities = batchModelKey
      ? resolveBuiltinCapabilitiesByModelKey('video', batchModelKey)
      : undefined
    const episodeId = body?.episodeId
    if (!episodeId) {
      throw new ApiError('INVALID_PARAMS')
    }

    const panels = await prisma.novelPromotionPanel.findMany({
      where: {
        storyboard: { episodeId },
        OR: [
          { videoUrl: null },
          { videoUrl: '' },
        ],
      },
      select: {
        id: true,
        storyboardId: true,
        panelIndex: true,
        imageUrl: true,
        videoPrompt: true,
        videoPromptEditedByUser: true,
        description: true,
        srtSegment: true,
        videoDurationBinding: true,
        shotType: true,
        cameraMove: true,
        sceneType: true,
        storyboard: {
          select: {
            episodeId: true,
            clip: {
              select: {
                content: true,
              },
            },
          },
        },
      },
    })
    const panelsForReadiness = await resolvePanelsReadinessInputs(panels, body)
    const readiness = panelsForReadiness.map((panel) => ({
      panel,
      issue: resolvePanelVideoReadinessIssue(panel, {
        payload: body,
        modelKey: batchModelKey,
        durationOptions: batchCapabilities?.video?.durationOptions,
      }),
    }))
    const readyPanels = readiness
      .filter((item) => item.issue === null)
      .map((item) => item.panel)
    const skippedReasons = summarizeVideoReadinessIssues(readiness.map((item) => item.issue))

    if (readyPanels.length === 0) {
      return NextResponse.json({
        tasks: [],
        total: 0,
        skipped: panels.length,
        skippedReasons,
      })
    }

    const results = await Promise.all(
      readyPanels.map(async (panel) => {
        return await submitTask({
          userId: session.user.id,
          locale,
          requestId: getRequestId(request),
          projectId,
          episodeId,
          type: TASK_TYPE.VIDEO_PANEL,
          targetType: 'NovelPromotionPanel',
          targetId: panel.id,
          payload: withTaskUiPayload(body, {
            hasOutputAtStart: await hasPanelVideoOutput(panel.id),
          }),
          dedupeKey: `video_panel:${panel.id}`,
          billingInfo: buildVideoPanelBillingInfoOrThrow(body),
        })
      }),
    )

    return NextResponse.json({
      tasks: results,
      total: readyPanels.length,
      skipped: panels.length - readyPanels.length,
      skippedReasons,
    })
  }

  const storyboardId = body?.storyboardId
  const panelIndex = body?.panelIndex
  if (!storyboardId || panelIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: { storyboardId, panelIndex: Number(panelIndex) },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      imageUrl: true,
      videoPrompt: true,
      videoPromptEditedByUser: true,
      description: true,
      srtSegment: true,
      videoDurationBinding: true,
      shotType: true,
      cameraMove: true,
      sceneType: true,
      storyboard: {
        select: {
          episodeId: true,
          clip: {
            select: {
              content: true,
            },
          },
        },
      },
    },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const singleModelKey = resolveVideoModelKeyFromPayload(body)
  const singleCapabilities = singleModelKey
    ? resolveBuiltinCapabilitiesByModelKey('video', singleModelKey)
    : undefined
  const panelForReadiness = await resolvePanelReadinessInput(panel, body)
  const readinessIssue = resolvePanelVideoReadinessIssue(panelForReadiness, {
    payload: body,
    modelKey: singleModelKey,
    durationOptions: singleCapabilities?.video?.durationOptions,
  })
  if (readinessIssue) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_READINESS_BLOCKED',
      field: 'videoDurationBinding',
      details: {
        issue: readinessIssue,
      },
    })
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: panel.storyboard.episodeId,
    type: TASK_TYPE.VIDEO_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(body, {
      hasOutputAtStart: await hasPanelVideoOutput(panel.id),
    }),
    dedupeKey: `video_panel:${panel.id}`,
    billingInfo: buildVideoPanelBillingInfoOrThrow(body),
  })

  return NextResponse.json(result)
})
