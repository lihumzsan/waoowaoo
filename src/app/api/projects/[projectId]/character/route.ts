import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuth, requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

// 更新角色信息（名字或介绍）
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { characterId, name, introduction } = body

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (!name && introduction === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'update_character',
    projectId,
    userId: authResult.session.user.id,
    input: {
      characterId,
      ...(name ? { name } : {}),
      ...(introduction !== undefined ? { introduction } : {}),
    },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})

// 删除角色（级联删除关联的形象记录）
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const characterId = searchParams.get('id')

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'delete_asset',
    projectId,
    userId: authResult.session.user.id,
    input: {
      target: { kind: 'character', assetId: characterId },
    },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})

// 新增角色
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => ({}))

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'create_character',
    projectId,
    userId: authResult.session.user.id,
    input: body,
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})
