import { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { handleProjectAgentRunControlRequest } from '../control'

export const runtime = 'nodejs'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; runId: string }> },
) => {
  const { projectId, runId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  return await handleProjectAgentRunControlRequest({
    request,
    projectId,
    runId,
    kind: 'task_follow_up',
  })
})
