import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const CURRENCY = 'CNY'

/**
 * GET /api/user/costs
 * 获取当前用户所有项目费用汇总
 */
export const GET = apiHandler(async () => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const userId = session.user.id

  return NextResponse.json({
    userId,
    currency: CURRENCY,
    total: 0,
    byProject: []
  })
})
