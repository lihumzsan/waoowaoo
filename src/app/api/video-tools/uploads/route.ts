import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getSignedUrl, uploadObject } from '@/lib/storage'
import { buildVideoToolInputKey, validateVideoToolUpload } from '@/lib/video-tools/seam-concat'

export const runtime = 'nodejs'

function invalidUpload(error: unknown): ApiError {
  const code = error instanceof Error ? error.message : 'VIDEO_TOOL_UPLOAD_INVALID'
  return new ApiError('INVALID_PARAMS', { code, field: 'file', message: code })
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_TOOL_UPLOAD_REQUIRED',
      field: 'file',
    })
  }

  let metadata: ReturnType<typeof validateVideoToolUpload>
  try {
    metadata = validateVideoToolUpload({
      name: file.name,
      type: file.type,
      size: file.size,
    })
  } catch (error) {
    throw invalidUpload(error)
  }

  const key = buildVideoToolInputKey(session.user.id, metadata.extension)
  const buffer = Buffer.from(await file.arrayBuffer())
  await uploadObject(buffer, key, undefined, metadata.mimeType)

  return NextResponse.json({
    success: true,
    key,
    url: getSignedUrl(key),
    name: file.name,
    size: file.size,
    mimeType: metadata.mimeType,
  })
})
