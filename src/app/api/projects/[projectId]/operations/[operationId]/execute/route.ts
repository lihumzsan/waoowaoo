import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { isPlannedOperation } from '@/lib/operations/types'
import { WORKSPACE_RESOURCE_IMPACT } from '@/lib/workspace-resource/resource-impact'
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
  const planSnapshotId = typeof body.planSnapshotId === 'string' ? body.planSnapshotId.trim() : ''
  const operationRequestId = typeof body.operationRequestId === 'string' ? body.operationRequestId.trim() : ''
  if (!operationRequestId) throw new ApiError('INVALID_PARAMS')
  const operation = createProjectAgentOperationRegistryForApi()[operationId]
  if (!operation) throw new ApiError('NOT_FOUND')
  const planned = isPlannedOperation(operation)
  if (planned !== Boolean(planSnapshotId)) throw new ApiError('INVALID_PARAMS')
  // Destructive actions keep their existing input-bound confirmation adapters.
  if (!planned && (operation.effects.destructive || operation.confirmation.kind !== 'none')) {
    throw new ApiError('FORBIDDEN', { code: 'OPERATION_CONFIRMATION_REQUIRED', operationId })
  }
  const headerRequestId = readOperationRequestId(request, {
    required: true,
    operationId,
  })
  assertOperationRequestIdMatches(headerRequestId, operationRequestId, operationId)
  const routeContext = isRecord(body.context) ? body.context : {}

  const execution = {
    request,
    operationId,
    projectId,
    userId: authResult.session.user.id,
    input: planned ? {
      ...body.input,
      planSnapshotId,
      operationRequestId,
    } : body.input,
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
    requireIdempotencyKey: true,
  }
  const mutationResponse = operation.effects.writes
    && operation.effects.workspaceResourceImpact !== WORKSPACE_RESOURCE_IMPACT.NONE
  const result = mutationResponse
    ? await executeProjectAgentOperationFromApi({ ...execution, responseContract: 'operation_mutation_response_v1' })
    : await executeProjectAgentOperationFromApi(execution)

  return NextResponse.json(result)
})
