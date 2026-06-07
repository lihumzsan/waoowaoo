import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

type LegacyCopyBody = {
  type?: 'character' | 'location' | 'prop'
  targetId?: string
  globalAssetId?: string
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  let body: LegacyCopyBody
  try {
    body = (await request.json()) as LegacyCopyBody
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }
  if (
    (body.type !== 'character' && body.type !== 'location' && body.type !== 'prop')
    || typeof body.targetId !== 'string'
    || body.targetId.trim().length === 0
    || typeof body.globalAssetId !== 'string'
    || body.globalAssetId.trim().length === 0
  ) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'copy_asset_from_global',
    projectId,
    userId: authResult.session.user.id,
    input: {
      type: body.type,
      targetId: body.targetId,
      globalAssetId: body.globalAssetId,
    },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
