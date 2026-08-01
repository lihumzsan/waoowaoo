import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { field: 'body' })
  }
  if (!isRecord(body)) {
    throw new ApiError('INVALID_PARAMS', { field: 'body' })
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'register_uploaded_media',
    projectId,
    userId: auth.session.user.id,
    input: body,
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
    requireIdempotencyKey: true,
  })

  return NextResponse.json(result)
})
