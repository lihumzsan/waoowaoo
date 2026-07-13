import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { createFreeVoiceRecord, listFreeVoiceRecords } from '@/lib/voice/free-voice'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  return NextResponse.json({ records: await listFreeVoiceRecords(projectId) })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const body = await request.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text : ''
  const characterId = typeof body?.characterId === 'string' ? body.characterId : ''
  const voiceSourceType = body?.voiceSourceType === 'global_voice' ? 'global_voice' : 'character'
  if (!text.trim() || !characterId) throw new ApiError('INVALID_PARAMS')
  const result = await createFreeVoiceRecord({
    projectId,
    userId: auth.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    requestId: getRequestId(request),
    text,
    characterId,
    voiceSourceType,
    voiceSourceId: typeof body?.voiceSourceId === 'string' ? body.voiceSourceId : null,
  })
  return NextResponse.json({ success: true, async: true, ...result })
})
