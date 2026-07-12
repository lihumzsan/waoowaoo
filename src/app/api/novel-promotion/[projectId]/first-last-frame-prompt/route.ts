import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import {
  FirstLastFramePromptValidationError,
  buildFirstLastFramePromptFingerprint,
  loadAdjacentFirstLastFramePanels,
  type FirstLastFramePromptReason,
} from '@/lib/novel-promotion/first-last-frame-prompt'
import {
  COMFYUI_LTX23_GOON_FPS,
  resolveLtx23GoonFrameCount,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { TASK_TYPE } from '@/lib/task/types'
import { parseVideoDurationBinding } from '@/lib/video-duration/audio-binding'

const REASONS = new Set<FirstLastFramePromptReason>(['link', 'source_change', 'manual'])

function buildPersistedSmartDurationResponse(
  rawBinding: unknown,
  fallbackFingerprint: string,
) {
  const binding = parseVideoDurationBinding(rawBinding)
  if (binding.durationSource !== 'smart' || typeof binding.targetDurationSeconds !== 'number') return undefined
  return {
    durationSeconds: binding.targetDurationSeconds,
    frameCount: resolveLtx23GoonFrameCount(binding.targetDurationSeconds),
    fps: COMFYUI_LTX23_GOON_FPS,
    confidence: binding.recommendationConfidence ?? 0,
    reason: binding.recommendationReason || '智能推荐时长',
    fingerprint: binding.recommendationFingerprint || fallbackFingerprint,
    source: 'smart' as const,
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const rawBody = await request.json().catch(() => ({}))
  const firstPanelId = typeof rawBody?.firstPanelId === 'string' ? rawBody.firstPanelId.trim() : ''
  const lastPanelId = typeof rawBody?.lastPanelId === 'string' ? rawBody.lastPanelId.trim() : ''
  const episodeId = typeof rawBody?.episodeId === 'string' && rawBody.episodeId.trim()
    ? rawBody.episodeId.trim()
    : undefined
  const reason = rawBody?.reason as FirstLastFramePromptReason
  if (!firstPanelId || !lastPanelId || firstPanelId === lastPanelId || !REASONS.has(reason)) {
    throw new ApiError('INVALID_PARAMS')
  }

  try {
    const panels = await loadAdjacentFirstLastFramePanels({
      projectId,
      firstPanelId,
      lastPanelId,
      episodeId,
      requireLinked: true,
    })
    const sourceFingerprint = buildFirstLastFramePromptFingerprint(
      panels.firstPanel as unknown as Record<string, unknown>,
      panels.lastPanel as unknown as Record<string, unknown>,
    )
    if (
      reason === 'source_change'
      && panels.firstPanel.firstLastFramePrompt
      && panels.firstPanel.firstLastFramePromptSourceFingerprint === sourceFingerprint
    ) {
      return NextResponse.json({
        prompt: panels.firstPanel.firstLastFramePrompt,
        sourceFingerprint,
        applied: true,
        fallbackUsed: false,
        warnings: [],
        smartDuration: buildPersistedSmartDurationResponse(
          panels.firstPanel.videoDurationBinding,
          sourceFingerprint,
        ),
      })
    }

    const body = {
      firstPanelId,
      lastPanelId,
      ...(episodeId ? { episodeId } : {}),
      reason,
    }
    const asyncTaskResponse = await maybeSubmitLLMTask({
      request,
      userId: authResult.session.user.id,
      projectId,
      episodeId: episodeId || null,
      type: TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT,
      targetType: 'NovelPromotionPanel',
      targetId: firstPanelId,
      routePath: `/api/novel-promotion/${projectId}/first-last-frame-prompt`,
      body,
      dedupeKey: `${TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT}:${firstPanelId}:${lastPanelId}:${sourceFingerprint}`,
    })
    if (asyncTaskResponse) return asyncTaskResponse
  } catch (error) {
    if (error instanceof FirstLastFramePromptValidationError) {
      throw new ApiError('INVALID_PARAMS')
    }
    throw error
  }

  // sync mode is disabled for this route; prompt generation only runs in the text worker.
  throw new ApiError('INVALID_PARAMS')
})
