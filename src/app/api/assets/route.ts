import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { AssetKind, AssetScope } from '@/lib/assets/contracts'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

function isAssetScope(value: string | null): value is AssetScope {
  return value === 'global'
}

function isAssetKind(value: string | null): value is AssetKind {
  return value === 'character' || value === 'location' || value === 'prop'
}

export const GET = apiHandler(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams
  const scope = searchParams.get('scope')
  const folderId = searchParams.get('folderId')
  const kind = searchParams.get('kind')

  if (!isAssetScope(scope)) {
    throw new ApiError('INVALID_PARAMS', { details: 'scope must be global' })
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_read',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: {
      scope,
      folderId,
      kind: isAssetKind(kind) ? kind : null,
    },
    source: 'asset-hub',
  })
  return NextResponse.json(result)
})

type CreateAssetBody = {
  scope?: AssetScope
  kind?: AssetKind
} & Record<string, unknown>

export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json() as CreateAssetBody
  if (body.scope !== 'global') {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_create',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: body,
    source: 'asset-hub',
    responseContract: 'operation_mutation_response_v1',
  })
  return NextResponse.json(result)
})
