import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { AssetKind, AssetScope } from '@/lib/assets/contracts'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

type UpdateVariantBody = {
  scope?: AssetScope
  kind?: Extract<AssetKind, 'character' | 'location' | 'prop'>
} & Record<string, unknown>

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ assetId: string; variantId: string }> },
) => {
  const { assetId, variantId } = await context.params
  const body = await request.json() as UpdateVariantBody
  if (body.scope !== 'global') {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_update_variant',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: { assetId, variantId, ...body },
    source: 'asset-hub',
    responseContract: 'operation_mutation_response_v1',
  })
  return NextResponse.json(result)
})
