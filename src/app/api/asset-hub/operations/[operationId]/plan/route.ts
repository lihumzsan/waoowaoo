import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { planProjectAgentOperationFromApi } from '@/lib/operations/planning'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ operationId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { operationId } = await context.params
  if (!operationId.startsWith('asset_hub_')) {
    throw new ApiError('NOT_FOUND', { code: 'ASSET_HUB_OPERATION_REQUIRED' })
  }
  const bodyUnknown: unknown = await request.json().catch(() => ({}))
  const body = isRecord(bodyUnknown) ? bodyUnknown : {}
  const input = isRecord(body.input) ? body.input : body
  const routeContext = isRecord(body.context) ? body.context : {}
  return NextResponse.json(await planProjectAgentOperationFromApi({
    request,
    operationId,
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    context: {
      locale: typeof routeContext.locale === 'string' ? routeContext.locale : null,
    },
    input,
    source: 'asset-hub',
  }))
})
