import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

/**
 * POST - 为现有角色添加子形象
 * Body: { characterId, changeReason, description }
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { characterId, changeReason, description } = body

  if (!characterId || !changeReason || !description) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'create_character_appearance',
    projectId,
    userId: authResult.session.user.id,
    input: {
      characterId,
      changeReason,
      description,
    },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})

/**
 * PATCH - 更新角色形象描述
 * Body: { characterId, appearanceId, description, descriptionIndex }
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { characterId, appearanceId, description, descriptionIndex } = body

  if (!characterId || !appearanceId || !description) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'update_character_appearance',
    projectId,
    userId: authResult.session.user.id,
    input: {
      characterId,
      appearanceId,
      description,
      ...(descriptionIndex !== undefined ? { descriptionIndex } : {}),
    },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})

/**
 * DELETE - 删除单个角色形象
 * Query params: characterId, appearanceId
 */
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const characterId = searchParams.get('characterId')
  const appearanceId = searchParams.get('appearanceId')

  if (!characterId || !appearanceId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'delete_character_appearance',
    projectId,
    userId: authResult.session.user.id,
    input: {
      characterId,
      appearanceId,
    },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})
