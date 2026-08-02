import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import {
  assertOperationRequestIdMatches,
  readOperationRequestId,
} from '@/lib/operations/api-request-identity'

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
  const headerRequestId = readOperationRequestId(request, {
    required: true,
    operationId,
  })
  assertOperationRequestIdMatches(headerRequestId, operationRequestId, operationId)
  const routeContext = isRecord(body.context) ? body.context : {}

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
    context: {
      locale: typeof routeContext.locale === 'string' ? routeContext.locale : null,
      selectedScopeRef: typeof routeContext.selectedScopeRef === 'string'
        ? routeContext.selectedScopeRef
        : null,
      selectedAssetId: typeof routeContext.selectedAssetId === 'string'
        ? routeContext.selectedAssetId
        : null,
    },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
