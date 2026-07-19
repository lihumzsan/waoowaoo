import { NextResponse } from 'next/server'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getVideoToolFreeVoiceAudio } from '@/lib/video-tools/free-voice'

export const GET = apiHandler(async (
  _request,
  context: { params: Promise<{ recordId: string }> },
) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const { recordId } = await context.params
  if (!recordId) throw new ApiError('INVALID_PARAMS')

  const audio = await getVideoToolFreeVoiceAudio(auth.session.user.id, recordId)
  if (!audio) throw new ApiError('NOT_FOUND')

  return new NextResponse(audio.data, {
    headers: {
      'content-type': audio.mimeType,
      'cache-control': 'private, max-age=86400',
    },
  })
})
