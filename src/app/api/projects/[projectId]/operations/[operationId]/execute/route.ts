import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; operationId: string }> },
) => {
  const { projectId, operationId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body: unknown = await request.json()
  if (!isRecord(body) || !isRecord(body.input)) throw new ApiError('INVALID_PARAMS')
  const approvalGrantId = typeof body.approvalGrantId === 'string' ? body.approvalGrantId.trim() : ''
  const operationRequestId = typeof body.operationRequestId === 'string' ? body.operationRequestId.trim() : ''
  if (!approvalGrantId || !operationRequestId) throw new ApiError('INVALID_PARAMS')

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId,
    projectId,
    userId: authResult.session.user.id,
    input: {
      ...body.input,
      approvalGrantId,
      operationRequestId,
    },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
