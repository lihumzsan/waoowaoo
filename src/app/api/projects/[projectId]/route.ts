import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

// GET - 获取项目详情
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'get_project_basic',
    projectId,
    userId: authResult.session.user.id,
    input: {},
    source: 'project-ui',
  })

  return NextResponse.json(result)
})

// PATCH - 更新项目配置
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

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
    operationId: 'update_project',
    projectId,
    userId: authResult.session.user.id,
    input: body,
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})

// DELETE - 删除项目及其领域关系；共享媒体回收由独立 lifecycle owner 负责
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'delete_project',
    projectId,
    userId: authResult.session.user.id,
    input: {},
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
