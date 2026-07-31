import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

/**
 * GET - 获取单个剧集的完整数据
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'get_episode_detail',
    projectId,
    userId: authResult.session.user.id,
    input: { episodeId },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})

/**
 * PATCH - 更新剧集信息
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { name, description, novelText, audioUrl, srtContent } = body

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'update_episode',
    projectId,
    userId: authResult.session.user.id,
    input: {
      episodeId,
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(novelText !== undefined ? { novelText } : {}),
      ...(audioUrl !== undefined ? { audioUrl } : {}),
      ...(srtContent !== undefined ? { srtContent } : {}),
    },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})

/**
 * DELETE - 删除剧集
 */
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'delete_episode',
    projectId,
    userId: authResult.session.user.id,
    input: {
      episodeId,
    },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})
