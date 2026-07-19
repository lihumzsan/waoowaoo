import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { addTaskJob, videoQueue } from '@/lib/task/queues'
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

  const taskId = randomUUID()
  const targetId = randomUUID()
  await addTaskJob({
    taskId,
    persistence: 'transient',
    userId: session.user.id,
    locale,
    projectId: VIDEO_TOOLS_PROJECT_ID,
    type: TASK_TYPE.VIDEO_SEAM_CONCAT,
    targetType: 'VideoSeamConcat',
    targetId,
    payload,
    trace: { requestId: getRequestId(request) },
  }, {
    attempts: 1,
    removeOnComplete: { age: 10 * 60, count: 20 },
    removeOnFail: { age: 10 * 60, count: 20 },
  })

  return NextResponse.json({
    success: true,
    async: true,
    taskId,
    status: 'queued',
  })
})

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const taskId = request.nextUrl.searchParams.get('taskId')?.trim()
  if (!taskId) throw new ApiError('INVALID_PARAMS')

  const job = await videoQueue.getJob(taskId)
  if (
    !job
    || job.data.persistence !== 'transient'
    || job.data.type !== TASK_TYPE.VIDEO_SEAM_CONCAT
    || job.data.userId !== session.user.id
  ) {
    throw new ApiError('NOT_FOUND')
  }

  const state = await job.getState()
  const status = state === 'completed'
    ? 'completed'
    : state === 'failed'
      ? 'failed'
      : state === 'active'
        ? 'processing'
        : 'queued'
  const rawProgress = job.progress
  const progressPayload = rawProgress && typeof rawProgress === 'object' && !Array.isArray(rawProgress)
    ? rawProgress as Record<string, unknown>
    : null
  const progressValue = typeof rawProgress === 'number'
    ? rawProgress
    : typeof progressPayload?.progress === 'number'
      ? progressPayload.progress
      : 0

  return NextResponse.json({
    id: taskId,
    status,
    progress: status === 'completed' ? 100 : Math.max(0, Math.min(99, Math.floor(progressValue))),
    payload: progressPayload,
    result: status === 'completed' && job.returnvalue && typeof job.returnvalue === 'object'
      ? job.returnvalue
      : null,
    error: status === 'failed'
      ? { message: job.failedReason || 'VIDEO_SEAM_CONCAT_FAILED' }
      : null,
  })
})
