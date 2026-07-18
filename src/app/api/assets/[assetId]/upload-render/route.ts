import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { parseProjectUploadRenderFormData } from '@/lib/assets/upload-render-form'
import { MAX_MULTIPART_IMAGE_REQUEST_BYTES, readFormDataWithLimit } from '@/lib/http/body-limits'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) => {
  const { assetId } = await context.params
  const userAuthResult = await requireUserAuth()
  if (isErrorResponse(userAuthResult)) return userAuthResult
  const formData = await readFormDataWithLimit(
    request,
    MAX_MULTIPART_IMAGE_REQUEST_BYTES,
    'asset render upload',
  )

  const input = parseProjectUploadRenderFormData(formData, assetId)
  const authResult = await requireProjectAuthLight(input.projectId)
  if (isErrorResponse(authResult)) return authResult

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_assets_upload_render',
    projectId: input.projectId,
    userId: authResult.session.user.id,
    input,
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
