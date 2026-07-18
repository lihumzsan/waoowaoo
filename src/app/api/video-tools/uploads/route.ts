import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getSignedUrl, uploadObjectStream } from '@/lib/storage'
import { buildVideoToolInputKey, validateVideoToolUpload } from '@/lib/video-tools/seam-concat'

export const runtime = 'nodejs'

function invalidUpload(error: unknown): ApiError {
  const code = error instanceof Error ? error.message : 'VIDEO_TOOL_UPLOAD_INVALID'
  return new ApiError('INVALID_PARAMS', { code, field: 'file', message: code })
}

function readUploadName(request: NextRequest): string {
  const encodedName = request.headers.get('x-file-name')?.trim()
  if (!encodedName) {
    throw new Error('VIDEO_TOOL_UPLOAD_REQUIRED')
  }

  try {
    const name = decodeURIComponent(encodedName).trim()
    if (!name) throw new Error('VIDEO_TOOL_UPLOAD_REQUIRED')
    return name
  } catch (error) {
    if (error instanceof Error && error.message === 'VIDEO_TOOL_UPLOAD_REQUIRED') throw error
    throw new Error('VIDEO_TOOL_UPLOAD_NAME_INVALID')
  }
}

function readUploadLength(request: NextRequest): number {
  const rawLength = request.headers.get('content-length')?.trim()
  if (!rawLength) {
    throw new Error('VIDEO_TOOL_UPLOAD_LENGTH_REQUIRED')
  }
  if (!/^\d+$/.test(rawLength)) {
    throw new Error('VIDEO_TOOL_UPLOAD_LENGTH_INVALID')
  }

  const contentLength = Number(rawLength)
  if (!Number.isSafeInteger(contentLength)) {
    throw new Error('VIDEO_TOOL_UPLOAD_LENGTH_INVALID')
  }
  return contentLength
}

function validateStreamLength(
  body: ReadableStream<Uint8Array>,
  expectedLength: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let receivedLength = 0

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          if (receivedLength !== expectedLength) {
            controller.error(new Error('VIDEO_TOOL_UPLOAD_LENGTH_MISMATCH'))
          } else {
            controller.close()
          }
          return
        }

        receivedLength += chunk.value.byteLength
        if (receivedLength > expectedLength) {
          await reader.cancel('VIDEO_TOOL_UPLOAD_LENGTH_MISMATCH')
          controller.error(new Error('VIDEO_TOOL_UPLOAD_LENGTH_MISMATCH'))
          return
        }
        controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  let metadata: ReturnType<typeof validateVideoToolUpload>
  let name: string
  let contentLength: number
  try {
    name = readUploadName(request)
    contentLength = readUploadLength(request)
    metadata = validateVideoToolUpload({
      name,
      type: request.headers.get('content-type')?.split(';')[0]?.trim() || '',
      size: contentLength,
    })
  } catch (error) {
    throw invalidUpload(error)
  }

  if (!request.body) {
    throw invalidUpload(new Error('VIDEO_TOOL_UPLOAD_REQUIRED'))
  }

  const key = buildVideoToolInputKey(session.user.id, metadata.extension)
  try {
    await uploadObjectStream(
      validateStreamLength(request.body, contentLength),
      key,
      contentLength,
      metadata.mimeType,
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('LENGTH_MISMATCH')) {
      throw invalidUpload(new Error('VIDEO_TOOL_UPLOAD_LENGTH_MISMATCH'))
    }
    throw error
  }

  return NextResponse.json({
    success: true,
    key,
    url: getSignedUrl(key),
    name,
    size: contentLength,
    mimeType: metadata.mimeType,
  })
})
