import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { planProjectAgentOperationFromApi } from '@/lib/operations/planning'
import { readOperationRequestId } from '@/lib/operations/api-request-identity'

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
  const operationRequestId = readOperationRequestId(request, {
    required: true,
    operationId,
  })

  const bodyUnknown: unknown = await request.json().catch(() => ({}))
  const body = isRecord(bodyUnknown) ? bodyUnknown : {}
  const input = isRecord(body.input) ? body.input : body
  const routeContext = isRecord(body.context) ? body.context : {}

  const result = await planProjectAgentOperationFromApi({
    request,
    operationId,
    projectId,
    userId: authResult.session.user.id,
    operationRequestId,
    context: {
      locale: typeof routeContext.locale === 'string' ? routeContext.locale : null,
      selectedScopeRef: typeof routeContext.selectedScopeRef === 'string' ? routeContext.selectedScopeRef : null,
      selectedAssetId: typeof routeContext.selectedAssetId === 'string' ? routeContext.selectedAssetId : null,
    },
    input,
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
