import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { createFreeVoiceVersion } from '@/lib/voice/free-voice'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; recordId: string }> },
) => {
  const { projectId, recordId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const body = await request.json().catch(() => null)
  const result = await createFreeVoiceVersion({
    projectId,
    recordId,
    userId: auth.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    requestId: getRequestId(request),
  })
  return NextResponse.json({ success: true, async: true, ...result })
})
