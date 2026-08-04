import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { GetTaskInput } from '@/lib/operations/domains/task/task-ops'

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
  const includeEventsRequested = includeEvents === '1' || includeEvents === 'true'
  const excludeEventsRequested = includeEvents === null || includeEvents === '0' || includeEvents === 'false'
  if (!includeEventsRequested && !excludeEventsRequested) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TASK_EVENTS_MODE_INVALID',
      field: 'includeEvents',
    })
  }
  if (eventsLimit !== null && !includeEventsRequested) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TASK_EVENTS_LIMIT_WITHOUT_EVENTS',
      field: 'eventsLimit',
    })
  }

  const input: GetTaskInput = {
    taskId,
    events: includeEventsRequested
      ? {
          kind: 'include' as const,
          ...(eventsLimit !== null ? { limit: Number(eventsLimit) } : {}),
        }
      : { kind: 'none' as const },
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
