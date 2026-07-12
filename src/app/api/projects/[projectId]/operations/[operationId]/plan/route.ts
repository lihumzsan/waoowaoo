import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { planProjectAgentOperationFromApi } from '@/lib/operations/planning'

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

  const bodyUnknown: unknown = await request.json().catch(() => ({}))
  const body = isRecord(bodyUnknown) ? bodyUnknown : {}
  const input = isRecord(body.input) ? body.input : body
  const routeContext = isRecord(body.context) ? body.context : {}

  const result = await planProjectAgentOperationFromApi({
    request,
    operationId,
    projectId,
    userId: authResult.session.user.id,
    context: {
      locale: typeof routeContext.locale === 'string' ? routeContext.locale : null,
      episodeId: typeof routeContext.episodeId === 'string' ? routeContext.episodeId : null,
      selectedScopeRef: typeof routeContext.selectedScopeRef === 'string' ? routeContext.selectedScopeRef : null,
      selectedPanelId: typeof routeContext.selectedPanelId === 'string' ? routeContext.selectedPanelId : null,
      selectedAssetId: typeof routeContext.selectedAssetId === 'string' ? routeContext.selectedAssetId : null,
    },
    input,
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
