import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

const CURRENCY = 'CNY'

/**
 * GET /api/projects/[projectId]/costs
 * 获取项目费用详情
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { projectId } = await context.params

  // 验证项目归属
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, name: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  return NextResponse.json({
    projectId,
    projectName: project.name,
    currency: CURRENCY,
    total: 0,
    byType: [],
    byAction: [],
    recentRecords: []
  })
})
