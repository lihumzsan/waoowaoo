import { Queue } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { createScopedLogger } from '@/lib/logging/core'
import { QueueType, TaskType, type TaskJobData } from './types'
import { getTaskMaxAttempts, TASK_RETRY_BACKOFF_BASE_MS } from './retry-policy'
import { getTaskDefinition } from './definition'

export const QUEUE_NAME = {
  IMAGE: 'waoowaoo-image',
  VIDEO: 'waoowaoo-video',
  MUSIC: 'waoowaoo-music',
  TEXT: 'waoowaoo-text',
} as const

const defaultJobOptions = {
  removeOnComplete: 500,
  removeOnFail: 500,
}

type QueueSingleton = Partial<Record<QueueType, Queue<TaskJobData>>>
type TaskJobOptions = {
  priority?: number
}

const globalForQueues = globalThis as typeof globalThis & {
  __waoowaooQueues?: QueueSingleton
}

const queueSingleton = globalForQueues.__waoowaooQueues || {}
if (!globalForQueues.__waoowaooQueues) {
  globalForQueues.__waoowaooQueues = queueSingleton
}

function getOrCreateQueue(type: QueueType, name: string) {
  const existing = queueSingleton[type]
  if (existing) return existing
  const queue = new Queue<TaskJobData>(name, {
    connection: queueRedis,
    defaultJobOptions,
  })
  queueSingleton[type] = queue
  return queue
}

export function getImageQueue() {
  return getOrCreateQueue('image', QUEUE_NAME.IMAGE)
}

export function getVideoQueue() {
  return getOrCreateQueue('video', QUEUE_NAME.VIDEO)
}

export function getMusicQueue() {
  return getOrCreateQueue('music', QUEUE_NAME.MUSIC)
}

export function getTextQueue() {
  return getOrCreateQueue('text', QUEUE_NAME.TEXT)
}

export function getAllQueues() {
  return [getImageQueue(), getVideoQueue(), getMusicQueue(), getTextQueue()]
}

export function getQueueTypeByTaskType(type: TaskType): QueueType {
  return getTaskDefinition(type).queue
}

export function getQueueByType(type: QueueType) {
  switch (type) {
    case 'image':
      return getImageQueue()
    case 'video':
      return getVideoQueue()
    case 'music':
      return getMusicQueue()
    case 'text':
      return getTextQueue()
  }
}

const queueLogger = createScopedLogger({ module: 'task.queues' })

async function removeTerminalJobWithSameId(queue: Queue<TaskJobData>, data: TaskJobData) {
  const existing = await queue.getJob(data.taskId)
  if (!existing) return
  const state = await existing.getState()
  if (state !== 'completed' && state !== 'failed') {
    queueLogger.debug({
      action: 'queue.job.same_id_alive',
      message: 'same task id job already exists and is not terminal',
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      details: {
        queue: queue.name,
        taskType: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
        jobState: state,
      },
    })
    return
  }
  queueLogger.warn({
    action: 'queue.job.terminal_removed_before_enqueue',
    message: 'removing terminal BullMQ job before enqueueing replacement task',
    taskId: data.taskId,
    projectId: data.projectId,
    userId: data.userId,
    details: {
      queue: queue.name,
      taskType: data.type,
      targetType: data.targetType,
      targetId: data.targetId,
      jobState: state,
      failedReason: existing.failedReason || null,
      processedOn: existing.processedOn || null,
      finishedOn: existing.finishedOn || null,
    },
  })
  await existing.remove()
}

export async function addTaskJob(data: TaskJobData, opts?: TaskJobOptions) {
  const queueType = getQueueTypeByTaskType(data.type)
  const queue = getQueueByType(queueType)
  const priority = typeof opts?.priority === 'number' ? opts.priority : 0
  await removeTerminalJobWithSameId(queue, data)
  return await queue.add(data.type, data, {
    jobId: data.taskId,
    priority,
    attempts: getTaskMaxAttempts(data.type),
    backoff: {
      type: 'exponential',
      delay: TASK_RETRY_BACKOFF_BASE_MS,
    },
  })
}

export async function removeTaskJob(taskId: string) {
  for (const queue of getAllQueues()) {
    const job = await queue.getJob(taskId)
    if (!job) continue
    await job.remove()
    return true
  }
  return false
}
