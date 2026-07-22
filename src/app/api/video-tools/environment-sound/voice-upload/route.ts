import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { deleteObject, getSignedUrl, uploadObjectStream } from '@/lib/storage'
import {
  buildEnvironmentSoundVoiceInputKey,
  isOwnedEnvironmentSoundVoiceKey,
  validateEnvironmentSoundVoiceUpload,
} from '@/lib/video-tools/environment-sound'
import { scheduleEnvironmentSoundCleanup } from '@/lib/video-tools/environment-sound-cleanup'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'

export const runtime = 'nodejs'

function invalidUpload(error: unknown): ApiError {
  const code = error instanceof Error ? error.message : 'ENVIRONMENT_SOUND_VOICE_INVALID'
  return new ApiError('INVALID_PARAMS', { code, field: 'file', message: code })
}

function readUploadName(request: NextRequest): string {
  const encodedName = request.headers.get('x-file-name')?.trim()
  if (!encodedName) throw new Error('ENVIRONMENT_SOUND_VOICE_REQUIRED')
  try {
    const name = decodeURIComponent(encodedName).trim()
    if (!name) throw new Error('ENVIRONMENT_SOUND_VOICE_REQUIRED')
    return name
  } catch (error) {
    if (error instanceof Error && error.message === 'ENVIRONMENT_SOUND_VOICE_REQUIRED') throw error
    throw new Error('ENVIRONMENT_SOUND_VOICE_NAME_INVALID')
  }
}

function readUploadLength(request: NextRequest): number {
  const rawLength = request.headers.get('content-length')?.trim()
  if (!rawLength) throw new Error('ENVIRONMENT_SOUND_VOICE_LENGTH_REQUIRED')
  if (!/^\d+$/.test(rawLength)) throw new Error('ENVIRONMENT_SOUND_VOICE_LENGTH_INVALID')
  const contentLength = Number(rawLength)
  if (!Number.isSafeInteger(contentLength)) throw new Error('ENVIRONMENT_SOUND_VOICE_LENGTH_INVALID')
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
            controller.error(new Error('ENVIRONMENT_SOUND_VOICE_LENGTH_MISMATCH'))
          } else {
            controller.close()
          }
          return
        }
        receivedLength += chunk.value.byteLength
        if (receivedLength > expectedLength) {
          await reader.cancel('ENVIRONMENT_SOUND_VOICE_LENGTH_MISMATCH')
          controller.error(new Error('ENVIRONMENT_SOUND_VOICE_LENGTH_MISMATCH'))
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

  let name: string
  let contentLength: number
  let metadata: ReturnType<typeof validateEnvironmentSoundVoiceUpload>
  try {
    name = readUploadName(request)
    contentLength = readUploadLength(request)
    metadata = validateEnvironmentSoundVoiceUpload({
      name,
      type: request.headers.get('content-type')?.split(';')[0]?.trim() || '',
      size: contentLength,
    })
  } catch (error) {
    throw invalidUpload(error)
  }

  if (!request.body) throw invalidUpload(new Error('ENVIRONMENT_SOUND_VOICE_REQUIRED'))
  const key = buildEnvironmentSoundVoiceInputKey(session.user.id, metadata.extension)
  try {
    await uploadObjectStream(
      validateStreamLength(request.body, contentLength),
      key,
      contentLength,
      metadata.mimeType,
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('LENGTH_MISMATCH')) {
      throw invalidUpload(new Error('ENVIRONMENT_SOUND_VOICE_LENGTH_MISMATCH'))
    }
    throw error
  }

  let cleanup: Awaited<ReturnType<typeof scheduleEnvironmentSoundCleanup>>
  try {
    cleanup = await scheduleEnvironmentSoundCleanup({
      userId: session.user.id,
      locale: resolveRequiredTaskLocale(request),
      objectKey: key,
    })
  } catch (error) {
    await deleteObject(key).catch(() => undefined)
    throw error
  }

  return NextResponse.json({
    success: true,
    key,
    url: getSignedUrl(key),
    name,
    size: contentLength,
    mimeType: metadata.mimeType,
    expiresAt: cleanup.expiresAt,
  })
})

export const DELETE = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const body: unknown = await request.json().catch(() => null)
  const key = body && typeof body === 'object' && !Array.isArray(body)
    && typeof (body as { key?: unknown }).key === 'string'
    ? (body as { key: string }).key.trim()
    : ''
  if (!key || !isOwnedEnvironmentSoundVoiceKey(authResult.session.user.id, key)) {
    throw invalidUpload(new Error('ENVIRONMENT_SOUND_VOICE_NOT_OWNED'))
  }
  await deleteObject(key)
  return NextResponse.json({ success: true })
})
