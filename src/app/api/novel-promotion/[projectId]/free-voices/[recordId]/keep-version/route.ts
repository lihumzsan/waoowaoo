import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { keepOnlyFreeVoiceVersion } from '@/lib/voice/free-voice'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; recordId: string }> },
) => {
  const { projectId, recordId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const body = await request.json().catch(() => null)
  const versionId = typeof body?.versionId === 'string' ? body.versionId : ''
  if (!versionId) throw new ApiError('INVALID_PARAMS')
  const record = await keepOnlyFreeVoiceVersion({ projectId, recordId, versionId })
  return NextResponse.json({ success: true, record })
})
