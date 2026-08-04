import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { MAX_BASE64_IMAGE_REQUEST_BYTES, readJsonWithLimit } from '@/lib/http/body-limits'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

/**
 * POST /api/asset-hub/upload-temp
 * 上传临时文件（Base64），返回签名 URL
 * 支持图片和音频格式
 */
export const POST = apiHandler(async (request: NextRequest) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const body = await readJsonWithLimit(request, MAX_BASE64_IMAGE_REQUEST_BYTES, 'temporary image upload')

    const result = await executeProjectAgentOperationFromApi({
        request,
        operationId: 'api_asset_hub_upload_temp',
        projectId: GLOBAL_ASSET_PROJECT_ID,
        userId: authResult.session.user.id,
        input: body,
        source: 'asset-hub',
    })

    return NextResponse.json(result)
})
