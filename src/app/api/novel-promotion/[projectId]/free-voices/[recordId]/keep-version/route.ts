import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'

export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; recordId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  return NextResponse.json({
    success: false,
    message: 'PROJECT_FREE_VOICE_RETIRED_USE_VIDEO_TOOLS',
  }, { status: 409 })
})
