import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'

function hashContentForDedupe(content: string) {
  return createHash('sha1').update(content).digest('hex').slice(0, 16)
}

/**
 * AI 分集 API（任务化）
 */
export const POST = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const content = typeof body?.content === 'string' ? body.content : ''

  if (!content) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (content.length < 100) {
    throw new ApiError('INVALID_PARAMS')
  }

  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId,
    type: TASK_TYPE.EPISODE_SPLIT_LLM,
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    routePath: `/api/novel-promotion/${projectId}/episodes/split`,
    body: { content },
    dedupeKey: `episode_split_llm:${projectId}:${hashContentForDedupe(content)}`,
  })
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
