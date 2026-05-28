import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const CURRENCY = 'CNY'

/**
 * GET /api/user/balance
 * 获取当前用户余额
 */
export const GET = apiHandler(async () => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult

    return NextResponse.json({
        success: true,
        currency: CURRENCY,
        balance: 0,
        frozenAmount: 0,
        totalSpent: 0
    })
})
