import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { AssetKind, AssetScope } from '@/lib/assets/contracts'

function isAssetScope(value: string | null): value is AssetScope {
  return value === 'global' || value === 'project'
}

function isAssetKind(value: string | null): value is AssetKind {
  return value === 'character' || value === 'location' || value === 'prop'
}

export const GET = apiHandler(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams
  const scope = searchParams.get('scope')
  const projectId = searchParams.get('projectId')
  const folderId = searchParams.get('folderId')
  const kind = searchParams.get('kind')

  if (!isAssetScope(scope)) {
    throw new ApiError('INVALID_PARAMS', { details: 'scope must be global or project' })
  }

  if (scope === 'project') {
    if (!projectId) {
      throw new ApiError('INVALID_PARAMS', { details: 'projectId is required for project scope' })
    }
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'api_assets_read',
      projectId,
      userId: authResult.session.user.id,
      input: {
        scope,
        projectId,
        folderId,
        kind: isAssetKind(kind) ? kind : null,
      },
      source: 'project-ui',
    })
    return NextResponse.json(result)
  } else {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'api_assets_read',
      projectId: 'global-asset-hub',
      userId: authResult.session.user.id,
      input: {
        scope,
        projectId,
        folderId,
        kind: isAssetKind(kind) ? kind : null,
      },
      source: 'project-ui',
    })
    return NextResponse.json(result)
  }
})

type CreateAssetBody = {
  scope?: AssetScope
  kind?: AssetKind
  projectId?: string
} & Record<string, unknown>

export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json() as CreateAssetBody
  if (body.scope !== 'project' && body.scope !== 'global') {
    throw new ApiError('INVALID_PARAMS')
  }

  if (body.scope === 'project') {
    if (!body.projectId) {
      throw new ApiError('INVALID_PARAMS', { details: 'projectId is required for project scope' })
    }
    const authResult = await requireProjectAuthLight(body.projectId)
    if (isErrorResponse(authResult)) return authResult
    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'api_assets_create',
      projectId: body.projectId,
      userId: authResult.session.user.id,
      input: body,
      source: 'project-ui',
    })
    return NextResponse.json(result)
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_create',
    projectId: 'global-asset-hub',
    userId: authResult.session.user.id,
    input: body,
    source: 'project-ui',
  })
  return NextResponse.json(result)
})
