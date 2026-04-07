import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getUserModelConfig } from '@/lib/config-service'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { TASK_TYPE } from '@/lib/task/types'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    throw new ApiError('INVALID_PARAMS')
  }

  const userConfig = await getUserModelConfig(session.user.id)
  if (!userConfig.analysisModel) {
    throw new ApiError('MISSING_CONFIG')
  }

  const dedupeDigest = createHash('sha1')
    .update(`${session.user.id}:home-story-expand:${prompt}`)
    .digest('hex')
    .slice(0, 16)

  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId: 'home-ai-write',
    type: TASK_TYPE.AI_STORY_EXPAND,
    targetType: 'HomeAiStoryExpand',
    targetId: session.user.id,
    routePath: '/api/user/ai-story-expand',
    body: {
      prompt,
      analysisModel: userConfig.analysisModel,
    },
    dedupeKey: `home_ai_story_expand:${dedupeDigest}`,
    priority: 1,
  })
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
