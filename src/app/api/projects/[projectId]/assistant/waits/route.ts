import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import {
  claimResolvedProjectAgentWaitFollowUps,
  listResolvedProjectAgentWaitFollowUps,
} from '@/lib/project-agent/waits'

export const runtime = 'nodejs'

function readEpisodeId(request: NextRequest): string | null {
  const value = request.nextUrl.searchParams.get('episodeId')?.trim()
  return value || null
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const followUps = await listResolvedProjectAgentWaitFollowUps({
    projectId,
    userId: authResult.session.user.id,
    episodeId: readEpisodeId(request),
    assistantId: 'workspace-command',
  })

  return NextResponse.json({
    success: true,
    followUps,
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_WAIT_FOLLOW_UP_BODY',
      field: 'body',
      message: 'request body must be an object',
    })
  }
  const bodyRecord = body as Record<string, unknown>
  const action = typeof bodyRecord.action === 'string' ? bodyRecord.action.trim() : ''
  if (action === 'claim') {
    const episodeId = typeof bodyRecord.episodeId === 'string' && bodyRecord.episodeId.trim()
      ? bodyRecord.episodeId.trim()
      : readEpisodeId(request)
    const followUps = await claimResolvedProjectAgentWaitFollowUps({
      projectId,
      userId: authResult.session.user.id,
      episodeId,
      assistantId: 'workspace-command',
      limit: 1,
    })
    return NextResponse.json({
      success: true,
      followUps,
    })
  }

  // Claimed follow-ups are consumed exactly once by the chat endpoint via the
  // structured task_follow_up control action; there is no manual mark step.
  throw new ApiError('INVALID_PARAMS', {
    code: 'INVALID_WAIT_FOLLOW_UP_ACTION',
    field: 'action',
    message: 'only action=claim is supported',
  })
})
