import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { AssetKind } from '@/lib/assets/contracts'

type CopyBody = {
  kind?: AssetKind
  projectId?: string
  globalAssetId?: string
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) => {
  const { assetId } = await context.params
  const body = await request.json() as CopyBody
  if (!body.projectId || !body.globalAssetId || (body.kind !== 'character' && body.kind !== 'location' && body.kind !== 'prop')) {
    throw new ApiError('INVALID_PARAMS')
  }
  const authResult = await requireProjectAuthLight(body.projectId)
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_copy_from_global',
    projectId: body.projectId,
    userId: authResult.session.user.id,
    input: { assetId, ...body },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })
  return NextResponse.json(result)
})
