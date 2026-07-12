import { NextRequest } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import {
  FirstLastFramePromptValidationError,
  loadAdjacentFirstLastFramePanels,
  type FirstLastFramePromptReason,
} from '@/lib/novel-promotion/first-last-frame-prompt'
import { TASK_TYPE } from '@/lib/task/types'

const REASONS = new Set<FirstLastFramePromptReason>(['link', 'source_change', 'manual'])

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
    await loadAdjacentFirstLastFramePanels({ projectId, firstPanelId, lastPanelId, episodeId })
  } catch (error) {
    if (error instanceof FirstLastFramePromptValidationError) {
      throw new ApiError('INVALID_PARAMS')
    }
    throw error
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
    dedupeKey: `${TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT}:${firstPanelId}:${lastPanelId}`,
  })
  if (asyncTaskResponse) return asyncTaskResponse

  // sync mode is disabled for this route; prompt generation only runs in the text worker.
  throw new ApiError('INVALID_PARAMS')
})
