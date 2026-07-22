import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { AssetKind, AssetScope } from '@/lib/assets/contracts'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

type SelectRenderBody = {
  scope?: AssetScope
  kind?: Extract<AssetKind, 'character' | 'location' | 'prop'>
  projectId?: string
} & Record<string, unknown>

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) => {
  const { assetId } = await context.params
  const body = await request.json() as SelectRenderBody
  if ((body.scope !== 'global' && body.scope !== 'project')) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (body.scope === 'project') {
    if (!body.projectId) throw new ApiError('INVALID_PARAMS')
    const authResult = await requireProjectAuthLight(body.projectId)
    if (isErrorResponse(authResult)) return authResult
    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'api_assets_select_render',
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
    operationId: 'api_assets_select_render',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: { assetId, ...body },
    source: 'project-ui',
  })
  return NextResponse.json(result)
})
