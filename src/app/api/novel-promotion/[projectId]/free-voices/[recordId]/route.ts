import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { deleteFreeVoiceRecord } from '@/lib/voice/free-voice'

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; recordId: string }> },
) => {
  const { projectId, recordId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  return NextResponse.json({
    success: true,
    ...(await deleteFreeVoiceRecord({ projectId, recordId })),
  })
})
