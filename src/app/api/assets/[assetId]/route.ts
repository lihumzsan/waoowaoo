import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { AssetKind, AssetScope } from '@/lib/assets/contracts'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

type UpdateAssetBody = {
  scope?: AssetScope
  kind?: AssetKind
} & Record<string, unknown>

function isAssetScope(value: unknown): value is AssetScope {
  return value === 'global'
}

function isAssetKind(value: unknown): value is AssetKind {
  return value === 'character' || value === 'location' || value === 'prop'
}

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) => {
  const { assetId } = await context.params
  const body = await request.json() as UpdateAssetBody
  if (!isAssetScope(body.scope) || !isAssetKind(body.kind)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_update',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: { assetId, ...body },
    source: 'asset-hub',
    responseContract: 'operation_mutation_response_v1',
  })
  return NextResponse.json(result)
})

type DeleteAssetBody = {
  scope?: AssetScope
  kind?: AssetKind
}

function isDeletableKind(value: AssetKind | undefined): value is Extract<AssetKind, 'character' | 'location' | 'prop'> {
  return value === 'character' || value === 'location' || value === 'prop'
}

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) => {
  const { assetId } = await context.params
  const body = await request.json() as DeleteAssetBody
  if (!isAssetScope(body.scope) || !isDeletableKind(body.kind)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'delete_asset',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: {
      target: { kind: body.kind, assetId },
      scope: body.scope,
    },
    source: 'asset-hub',
    responseContract: 'operation_mutation_response_v1',
  })
  return NextResponse.json(result)
})
