import { Queue } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { createScopedLogger } from '@/lib/logging/core'
import { QueueType, TaskType, TASK_TYPE, type TaskJobData } from './types'
import { getTaskMaxAttempts, TASK_RETRY_BACKOFF_BASE_MS } from './retry-policy'

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

const TASK_QUEUE_TYPE = {
  [TASK_TYPE.IMAGE_PANEL]: 'image',
  [TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE]: 'text',
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: 'image',
  [TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN]: 'text',
  [TASK_TYPE.IMAGE_CHARACTER]: 'image',
  [TASK_TYPE.IMAGE_LOCATION]: 'image',
  [TASK_TYPE.MUSIC_GENERATE]: 'music',
  [TASK_TYPE.MUSIC_SCORE_PLAN]: 'music',
  [TASK_TYPE.SOUNDSCAPE_PLAN]: 'music',
  [TASK_TYPE.SOUNDSCAPE_GENERATE]: 'music',
  [TASK_TYPE.FINAL_VIDEO_RENDER]: 'video',
  [TASK_TYPE.CHAPTER_RENDER]: 'video',
  [TASK_TYPE.VIDEO_PANEL]: 'video',
  [TASK_TYPE.VIDEO_GROUP]: 'video',
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: 'image',
  [TASK_TYPE.REGENERATE_GROUP]: 'image',
  [TASK_TYPE.ASSET_HUB_IMAGE]: 'image',
  [TASK_TYPE.ASSET_HUB_MODIFY]: 'image',
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: 'text',
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: 'text',
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: 'text',
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: 'text',
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: 'text',
  [TASK_TYPE.AI_MODIFY_LOCATION]: 'text',
  [TASK_TYPE.AI_MODIFY_PROP]: 'text',
  [TASK_TYPE.AI_CREATE_CHARACTER]: 'text',
  [TASK_TYPE.AI_CREATE_LOCATION]: 'text',
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: 'text',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: 'text',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: 'text',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: 'text',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: 'text',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: 'text',
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: 'text',
} satisfies Record<TaskType, QueueType>

export function getQueueTypeByTaskType(type: TaskType): QueueType {
  return TASK_QUEUE_TYPE[type]
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
