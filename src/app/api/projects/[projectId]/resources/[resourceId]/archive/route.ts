import { NextRequest, NextResponse } from 'next/server'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string }> },
) => {
  const { projectId, resourceId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth

  const body: unknown = await request.json().catch(() => null)
  if (!isRecord(body) || typeof body.archived !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { field: 'archived' })
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'set_resource_archived',
    projectId,
    userId: auth.session.user.id,
    input: { resourceId, archived: body.archived },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
    requireIdempotencyKey: true,
  })

  return NextResponse.json(result)
})
