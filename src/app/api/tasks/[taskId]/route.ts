import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { taskId } = await context.params
  const includeEvents = request.nextUrl.searchParams.get('includeEvents')
  const eventsLimit = request.nextUrl.searchParams.get('eventsLimit')

  const input = {
    taskId,
    ...(includeEvents !== null
      ? { includeEvents: includeEvents === '1' || includeEvents === 'true' }
      : {}),
    ...(eventsLimit !== null ? { eventsLimit: Number(eventsLimit) } : {}),
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'get_task',
    projectId: 'system',
    userId: session.user.id,
    input,
    source: 'project-ui',
  })

  return NextResponse.json(result)
})

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { taskId } = await context.params

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'cancel_task',
    projectId: 'system',
    userId: session.user.id,
    input: { taskId },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
