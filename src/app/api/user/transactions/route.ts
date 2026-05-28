import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const CURRENCY = 'CNY'

/**
 * GET /api/user/transactions
 * 获取用户余额流水记录
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = parseInt(searchParams.get('pageSize') || '20')

  return NextResponse.json({
    currency: CURRENCY,
    transactions: [],
    pagination: {
      page,
      pageSize,
      total: 0,
      totalPages: 0,
    },
  })
})
