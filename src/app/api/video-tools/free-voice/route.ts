import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  createVideoToolFreeVoiceTask,
  listVideoToolFreeVoiceRecords,
} from '@/lib/video-tools/free-voice'

export const GET = apiHandler(async () => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  return NextResponse.json({
    records: await listVideoToolFreeVoiceRecords(auth.session.user.id),
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const body = await request.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
  const characterId = typeof body?.characterId === 'string' ? body.characterId.trim() : ''
  if (!text || !projectId || !characterId) throw new ApiError('INVALID_PARAMS')

  const result = await createVideoToolFreeVoiceTask({
    userId: auth.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    requestId: getRequestId(request),
    text,
    projectId,
    characterId,
  })

  return NextResponse.json({
    success: true,
    async: true,
    ...result,
  })
})
