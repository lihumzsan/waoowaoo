import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import {
  VIDEO_TOOLS_PROJECT_ID,
  parseVideoSeamConcatSubmission,
} from '@/lib/video-tools/seam-concat'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const body: unknown = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)

  let payload: ReturnType<typeof parseVideoSeamConcatSubmission>
  try {
    payload = parseVideoSeamConcatSubmission(session.user.id, body)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'VIDEO_TOOL_INPUTS_INVALID'
    throw new ApiError('INVALID_PARAMS', { code, message: code })
  }

  const targetId = randomUUID()
  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId: VIDEO_TOOLS_PROJECT_ID,
    type: TASK_TYPE.VIDEO_SEAM_CONCAT,
    targetType: 'VideoSeamConcat',
    targetId,
    payload,
    dedupeKey: `video_seam_concat:${targetId}`,
    maxAttempts: 1,
  })

  return NextResponse.json(result)
})
