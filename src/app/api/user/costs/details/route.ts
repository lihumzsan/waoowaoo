import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const CURRENCY = 'CNY'

/**
 * GET /api/user/costs/details
 * 获取用户费用明细（分页）
 */
export const GET = apiHandler(async (request: NextRequest) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    return NextResponse.json({
        success: true,
        currency: CURRENCY,
        records: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0
    })
})
