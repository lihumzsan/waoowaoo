import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { parseProjectUploadRenderFormData } from '@/lib/assets/upload-render-form'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) => {
  const { assetId } = await context.params
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FORMDATA_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid multipart/form-data',
    })
  }

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
