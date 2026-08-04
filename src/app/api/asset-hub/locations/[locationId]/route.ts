import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

// 获取单个场景
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ locationId: string }> }
) => {
    const { locationId } = await context.params

    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'asset_hub_get_location',
      projectId: GLOBAL_ASSET_PROJECT_ID,
      userId: session.user.id,
      input: { locationId },
      source: 'asset-hub',
    })

    return NextResponse.json(result)
})

// 更新场景
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ locationId: string }> }
) => {
    const { locationId } = await context.params

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
      operationId: 'asset_hub_update_location',
      projectId: GLOBAL_ASSET_PROJECT_ID,
      userId: session.user.id,
      input: {
        ...(body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}),
        locationId,
      },
      source: 'asset-hub',
      responseContract: 'operation_mutation_response_v1',
    })

    return NextResponse.json(result)
})

// 删除场景
export const DELETE = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ locationId: string }> }
) => {
    const { locationId } = await context.params

    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const result = await executeProjectAgentOperationFromApi({
      request,
      operationId: 'delete_asset',
      projectId: GLOBAL_ASSET_PROJECT_ID,
      userId: session.user.id,
      input: {
        target: { kind: 'location', assetId: locationId },
        scope: 'global',
      },
      source: 'asset-hub',
      responseContract: 'operation_mutation_response_v1',
    })

    return NextResponse.json(result)
})
