import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { searchParams } = new URL(request.url)
  const folderId = searchParams.get('folderId') ?? undefined

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'asset_hub_list_characters',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: session.user.id,
    input: { ...(folderId !== undefined ? { folderId } : {}) },
    source: 'asset-hub',
  })

  return NextResponse.json(result)
})

export const POST = apiHandler(async (request: NextRequest) => {
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
    operationId: 'asset_hub_create_character',
    projectId: GLOBAL_ASSET_PROJECT_ID,
    userId: session.user.id,
    input: body,
    source: 'asset-hub',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})
