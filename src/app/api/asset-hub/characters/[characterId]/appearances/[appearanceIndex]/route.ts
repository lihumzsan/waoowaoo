import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

// 更新形象描述
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ characterId: string; appearanceIndex: string }> }
) => {
    const { characterId, appearanceIndex } = await context.params

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
      operationId: 'asset_hub_update_character_appearance',
      projectId: GLOBAL_ASSET_PROJECT_ID,
      userId: session.user.id,
      input: {
        ...(body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}),
        characterId,
        appearanceIndex,
      },
      source: 'asset-hub',
      responseContract: 'operation_mutation_response_v1',
    })

    return NextResponse.json(result)
})

// 添加新形象
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ characterId: string; appearanceIndex: string }> }
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
      operationId: 'asset_hub_add_character_appearance',
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

// 删除形象
export const DELETE = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ characterId: string; appearanceIndex: string }> }
) => {
    const { characterId, appearanceIndex } = await context.params

    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'asset_hub_delete_character_appearance',
      projectId: GLOBAL_ASSET_PROJECT_ID,
      userId: session.user.id,
      input: {
        characterId,
        appearanceIndex,
      },
      source: 'asset-hub',
      responseContract: 'operation_mutation_response_v1',
    })

    return NextResponse.json(result)
})
