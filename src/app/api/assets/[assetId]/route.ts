import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { AssetKind, AssetScope } from '@/lib/assets/contracts'

type UpdateAssetBody = {
  scope?: AssetScope
  kind?: AssetKind
  projectId?: string
} & Record<string, unknown>

function isAssetScope(value: unknown): value is AssetScope {
  return value === 'global' || value === 'project'
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

  if (body.scope === 'project') {
    if (!body.projectId) throw new ApiError('INVALID_PARAMS')
    const authResult = await requireProjectAuthLight(body.projectId)
    if (isErrorResponse(authResult)) return authResult
    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'api_assets_update',
      projectId: body.projectId,
      userId: authResult.session.user.id,
      input: { assetId, ...body },
      source: 'project-ui',
    })
    return NextResponse.json(result)
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_update',
    projectId: 'global-asset-hub',
    userId: authResult.session.user.id,
    input: { assetId, ...body },
    source: 'project-ui',
  })
  return NextResponse.json(result)
})

type DeleteAssetBody = {
  scope?: AssetScope
  kind?: AssetKind
  projectId?: string
}

function isDeletableKind(value: AssetKind | undefined): value is Extract<AssetKind, 'location' | 'prop'> {
  return value === 'location' || value === 'prop'
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

  if (body.scope === 'project') {
    if (!body.projectId) throw new ApiError('INVALID_PARAMS')
    const authResult = await requireProjectAuthLight(body.projectId)
    if (isErrorResponse(authResult)) return authResult
    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'api_assets_remove',
      projectId: body.projectId,
      userId: authResult.session.user.id,
      input: { assetId, ...body },
      source: 'project-ui',
    })
    return NextResponse.json(result)
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_remove',
    projectId: 'global-asset-hub',
    userId: authResult.session.user.id,
    input: { assetId, ...body },
    source: 'project-ui',
  })
  return NextResponse.json(result)
})
