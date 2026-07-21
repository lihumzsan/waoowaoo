import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuth, requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

// 删除场景（级联删除关联的图片记录）
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('id')

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  await executeProjectAgentOperationFromApi({
    request,
    operationId: 'delete_asset',
    projectId,
    userId: authResult.session.user.id,
    input: {
      target: { kind: 'location', assetId: locationId },
    },
    source: 'project-ui',
  })

  return NextResponse.json({ success: true })
})

// 新增场景
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
    operationId: 'create_location',
    projectId,
    userId: authResult.session.user.id,
    input: body,
    source: 'project-ui',
  })
  return NextResponse.json(result)
})

// 更新场景（名字或图片描述）
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { locationId, imageIndex, description, name } = body

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'patch_location',
    projectId,
    userId: authResult.session.user.id,
    input: body,
    source: 'project-ui',
  })
  return NextResponse.json(result)
})
