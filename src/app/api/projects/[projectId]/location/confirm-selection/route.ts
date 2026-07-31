import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

/**
 * POST - 确认场景选择并删除未选中的候选图片
 * Body: { locationId }
 * 
 * 工作流程：
 * 1. 验证已经选择了一张图片（有 isSelected 的图片）
 * 2. 删除其他未选中的图片（从 COS 和数据库）
 * 3. 将选中的图片设为唯一图片
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
  const { locationId } = body

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'confirm_location_selection',
    projectId,
    userId: authResult.session.user.id,
    input: {
      locationId,
    },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })

  return NextResponse.json(result)
})
