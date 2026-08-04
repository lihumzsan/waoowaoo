import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

/**
 * POST /api/asset-hub/appearances
 * 添加子形象
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_asset_hub_character_appearances_create',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: body,
    source: 'asset-hub',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})

/**
 * PATCH /api/asset-hub/appearances
 * 更新子形象描述
 */
export const PATCH = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_asset_hub_character_appearances_update',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: body,
    source: 'asset-hub',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})

/**
 * DELETE /api/asset-hub/appearances
 * 删除子形象
 */
export const DELETE = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const characterId = searchParams.get('characterId')
  const appearanceIndexRaw = searchParams.get('appearanceIndex')

  if (!characterId || !appearanceIndexRaw) {
    throw new ApiError('INVALID_PARAMS')
  }
  const appearanceIndex = Number.parseInt(appearanceIndexRaw, 10)
  if (!Number.isFinite(appearanceIndex)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_asset_hub_character_appearances_delete',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: authResult.session.user.id,
    input: { characterId, appearanceIndex },
    source: 'asset-hub',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})
