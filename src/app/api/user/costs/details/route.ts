import { NextRequest, NextResponse } from 'next/server'
import { getUserCostDetails } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * GET /api/user/costs/details
 * 获取用户费用明细（分页）
 */
export const GET = apiHandler(async (request: NextRequest) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10) || 20))
    const rawProjectId = searchParams.get('projectId')?.trim() || ''
    if (rawProjectId.length > 191) {
        return NextResponse.json({ error: 'PROJECT_ID_INVALID' }, { status: 400 })
    }
    const projectId = rawProjectId || undefined

    const result = await getUserCostDetails(session.user.id, page, pageSize, projectId)

    return NextResponse.json({
        success: true,
        currency: BILLING_CURRENCY,
        ...result
    })
})
