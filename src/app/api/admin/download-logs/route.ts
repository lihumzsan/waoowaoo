import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { readAllLogs } from '@/lib/logging/file-writer'
import { requireAdminUserId } from '@/lib/admin/admin-auth'

export const dynamic = 'force-dynamic'

// GET - 下载所有日志
export const GET = apiHandler(async () => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    requireAdminUserId(authResult.session.user.id)

    const logs = await readAllLogs()
    if (!logs) {
        throw new ApiError('NOT_FOUND', { code: 'LOGS_NOT_AVAILABLE' })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `waoowaoo-logs-${timestamp}.txt`

    return new NextResponse(logs, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    })
})
