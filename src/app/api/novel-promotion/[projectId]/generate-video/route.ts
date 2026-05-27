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

function mergeVoiceLinesById(
  relationLines: VideoReadinessVoiceLine[] | null | undefined,
  fallbackLines: VideoReadinessVoiceLine[] | null | undefined,
): VideoReadinessVoiceLine[] {
  const seen = new Set<string>()
  const merged: VideoReadinessVoiceLine[] = []
  for (const line of [...(relationLines || []), ...(fallbackLines || [])]) {
    if (!line.id || seen.has(line.id)) continue
    seen.add(line.id)
    merged.push(line)
  }
  return merged
}

async function resolvePanelReadinessInput(
  panel: PanelReadinessInput,
  episodeId?: unknown,
): Promise<PanelReadinessInput> {
  const effectiveEpisodeId = typeof episodeId === 'string' && episodeId
    ? episodeId
    : panel.storyboard?.episodeId
  if (
    !effectiveEpisodeId
    || !panel.storyboardId
    || typeof panel.panelIndex !== 'number'
  ) {
    return {
      ...panel,
      matchedVoiceLines: mergeVoiceLinesById(panel.matchedVoiceLines, []),
    }
  }

  const fallbackVoiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episodeId: effectiveEpisodeId,
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

  return {
    ...panel,
    matchedVoiceLines: mergeVoiceLinesById(panel.matchedVoiceLines, fallbackVoiceLines),
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
        matchedVoiceLines: {
          select: {
            id: true,
            content: true,
            audioDuration: true,
          },
        },
      },
    })
    const panelsForReadiness = await Promise.all(
      panels.map((panel) => resolvePanelReadinessInput(panel, episodeId)),
    )
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
      matchedVoiceLines: {
        select: {
          id: true,
          content: true,
          audioDuration: true,
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
  const panelForReadiness = await resolvePanelReadinessInput(panel)
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
