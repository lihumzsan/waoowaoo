import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { addTaskJob, videoQueue } from '@/lib/task/queues'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import {
  ENVIRONMENT_SOUND_PROJECT_ID,
  ENVIRONMENT_SOUND_TTL_SECONDS,
  parseEnvironmentSoundSubmission,
} from '@/lib/video-tools/environment-sound'

const ENVIRONMENT_SOUND_TASK_TYPES: ReadonlySet<TaskType> = new Set([
  TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE,
  TASK_TYPE.ENVIRONMENT_SOUND_GENERATE,
])

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const body: unknown = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)

  let payload: ReturnType<typeof parseEnvironmentSoundSubmission>
  try {
    payload = parseEnvironmentSoundSubmission(session.user.id, body)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'ENVIRONMENT_SOUND_SUBMISSION_INVALID'
    throw new ApiError('INVALID_PARAMS', { code, message: code })
  }

  const analyze = payload.action === 'analyze'
  const taskId = randomUUID()
  await addTaskJob({
    taskId,
    persistence: 'transient',
    userId: session.user.id,
    locale,
    projectId: ENVIRONMENT_SOUND_PROJECT_ID,
    type: analyze ? TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE : TASK_TYPE.ENVIRONMENT_SOUND_GENERATE,
    targetType: analyze ? 'EnvironmentSoundAnalyze' : 'EnvironmentSoundGenerate',
    targetId: randomUUID(),
    payload,
    trace: { requestId: getRequestId(request) },
  }, {
    attempts: 1,
    removeOnComplete: { age: ENVIRONMENT_SOUND_TTL_SECONDS, count: 200 },
    removeOnFail: { age: ENVIRONMENT_SOUND_TTL_SECONDS, count: 200 },
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
    || !ENVIRONMENT_SOUND_TASK_TYPES.has(job.data.type)
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
      ? { message: job.failedReason || 'ENVIRONMENT_SOUND_FAILED' }
      : null,
  })
})
