import type { JobsOptions } from 'bullmq'
import { resolveTaskLocaleFromBody } from './resolve-locale'
import { TASK_TYPE, type TaskJobData, type TaskType } from './types'

export const WATCHDOG_REENQUEUE_GRACE_MS = 30_000

const TASK_TYPE_SET: ReadonlySet<string> = new Set(Object.values(TASK_TYPE))

type QueuedTaskRecord = {
  id: string
  userId: string
  projectId: string
  episodeId?: string | null
  type: string
  targetType: string
  targetId: string
  status: string
  enqueuedAt?: Date | null
  priority?: number | null
  payload?: unknown
}

type RecoveryResult =
  | { status: 'enqueued'; task: QueuedTaskRecord }
  | { status: 'skipped' }
  | { status: 'invalid_type'; task: QueuedTaskRecord }
  | { status: 'locale_missing'; task: QueuedTaskRecord }

function toTaskType(value: string): TaskType | null {
  return TASK_TYPE_SET.has(value) ? value as TaskType : null
}

function toTaskPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function buildQueuedTaskRecoveryCutoff(
  now: Date,
  graceMs = WATCHDOG_REENQUEUE_GRACE_MS,
): Date {
  return new Date(now.getTime() - graceMs)
}

export async function recoverQueuedTaskCandidate(params: {
  taskId: string
  loadTask: (taskId: string) => Promise<QueuedTaskRecord | null>
  enqueue: (data: TaskJobData, options: JobsOptions) => Promise<unknown>
  markEnqueued: (taskId: string) => Promise<unknown>
}): Promise<RecoveryResult> {
  const task = await params.loadTask(params.taskId)
  if (!task || task.status !== 'queued' || task.enqueuedAt) {
    return { status: 'skipped' }
  }

  const taskType = toTaskType(task.type)
  if (!taskType) {
    return { status: 'invalid_type', task }
  }

  const payload = toTaskPayload(task.payload)
  const locale = resolveTaskLocaleFromBody(payload)
  if (!locale) {
    return { status: 'locale_missing', task }
  }

  await params.enqueue({
    taskId: task.id,
    type: taskType,
    locale,
    projectId: task.projectId,
    episodeId: task.episodeId || null,
    targetType: task.targetType,
    targetId: task.targetId,
    payload,
    userId: task.userId,
  }, {
    priority: typeof task.priority === 'number' ? task.priority : 0,
  })
  await params.markEnqueued(task.id)

  return { status: 'enqueued', task }
}
