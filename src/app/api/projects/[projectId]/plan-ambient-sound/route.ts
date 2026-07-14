import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  if (!isRecord(body)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
    })
  }

  const input: Record<string, unknown> = {}
  if (typeof body.episodeId === 'string') input.episodeId = body.episodeId
  if (typeof body.soundEffectModel === 'string') input.soundEffectModel = body.soundEffectModel

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'plan_episode_ambient_sound',
    projectId,
    userId: authResult.session.user.id,
    context: {
      episodeId: typeof body.episodeId === 'string' ? body.episodeId : null,
    },
    input,
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
