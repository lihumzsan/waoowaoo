import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

/**
 * GET - 获取项目的所有剧集
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { project } = authResult

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'list_episodes',
    projectId: project.id,
    userId: authResult.session.user.id,
    input: {},
    source: 'project-ui',
  })

  return NextResponse.json(result)
})

/**
 * POST - 创建新剧集
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { name, description, novelText } = body

  if (!name || name.trim().length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'create_episode',
    projectId,
    userId: authResult.session.user.id,
    input: {
      name,
      ...(description !== undefined ? { description } : {}),
      ...(novelText !== undefined ? { novelText } : {}),
    },
    source: 'project-ui',
  })

  return NextResponse.json(result, { status: 201 })
})
