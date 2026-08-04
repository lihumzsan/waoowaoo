import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

// 获取单个角色
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ characterId: string }> }
) => {
    const { characterId } = await context.params

    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'asset_hub_get_character',
      projectId: GLOBAL_ASSET_PROJECT_ID,
      userId: session.user.id,
      input: { characterId },
      source: 'asset-hub',
    })

    return NextResponse.json(result)
})

// 更新角色
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ characterId: string }> }
) => {
    const { characterId } = await context.params

    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new ApiError('INVALID_PARAMS', {
        code: 'BODY_PARSE_FAILED',
        field: 'body',
        message: 'request body must be valid JSON',
      })
    }

    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'asset_hub_update_character',
      projectId: GLOBAL_ASSET_PROJECT_ID,
      userId: session.user.id,
      input: {
        ...(body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}),
        characterId,
      },
      source: 'asset-hub',
      responseContract: 'operation_mutation_response_v1',
    })

    return NextResponse.json(result)
})

// 删除角色
export const DELETE = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ characterId: string }> }
) => {
    const { characterId } = await context.params

    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'delete_asset',
      projectId: GLOBAL_ASSET_PROJECT_ID,
      userId: session.user.id,
      input: {
        target: { kind: 'character', assetId: characterId },
        scope: 'global',
      },
      source: 'asset-hub',
      responseContract: 'operation_mutation_response_v1',
    })

    return NextResponse.json(result)
})
