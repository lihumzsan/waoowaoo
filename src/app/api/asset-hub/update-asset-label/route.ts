import { NextRequest } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST /api/asset-hub/update-asset-label
 * 资产中心不再支持图片黑边标识更新
 */
export const POST = apiHandler(async (request: NextRequest) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    void authResult

    const body = await request.json()
    const { type, id, newName, appearanceIndex } = body

    if (!type || !id || !newName) {
        throw new ApiError('INVALID_PARAMS')
    }

    void appearanceIndex

    if (type !== 'character' && type !== 'location') {
        throw new ApiError('INVALID_PARAMS')
    }

    throw new ApiError('INVALID_PARAMS', {
        code: 'GLOBAL_ASSET_LABEL_UPDATES_DISABLED',
        message: 'Global asset images no longer support label updates',
    })
})
