import { prisma } from '@/lib/prisma'
import { locales } from '@/i18n/routing'
import { createScopedLogger } from '@/lib/logging/core'
import { addTaskJob } from './queues'
import { taskUsesComfyUiProvider } from './service'
import { TASK_STATUS, TASK_TYPE, type TaskBillingInfo, type TaskJobData, type TaskType } from './types'

const STARTUP_ABORT_CODE = 'APP_RESTARTED_LOCAL_COMFYUI_TASK_ABORTED'
const TASK_TYPE_SET: ReadonlySet<string> = new Set(Object.values(TASK_TYPE))
const RE_ENQUEUE_BATCH_SIZE = 100

const logger = createScopedLogger({
  module: 'task.startup-recovery',
})

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toTaskType(value: unknown): TaskType | null {
  if (typeof value !== 'string') return null
  if (!TASK_TYPE_SET.has(value)) return null
  return value as TaskType
}

function toTaskPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toTaskBillingInfo(value: unknown): TaskBillingInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const billing = value as Record<string, unknown>
  if (billing.billable !== true && billing.billable !== false) return null
  return billing as TaskBillingInfo
}

function resolveTaskLocaleFromPayload(payload: unknown): TaskJobData['locale'] | null {
  const payloadObj = toObject(payload)
  const payloadMeta = toObject(payloadObj.meta)
  const raw = typeof payloadMeta.locale === 'string'
    ? payloadMeta.locale
    : typeof payloadObj.locale === 'string'
      ? payloadObj.locale
      : ''
  if (!raw.trim()) return null
  const normalized = raw.trim().toLowerCase()
  for (const locale of locales) {
    if (normalized === locale || normalized.startsWith(`${locale}-`)) {
      return locale
    }
  }
  return null
}

async function abortLocalComfyUiTask(taskId: string) {
  await prisma.task.updateMany({
    where: {
      id: taskId,
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
    },
    data: {
      status: TASK_STATUS.CANCELED,
      errorCode: STARTUP_ABORT_CODE,
      errorMessage: 'Local ComfyUI task was aborted because the app restarted',
      finishedAt: new Date(),
      startedAt: null,
      heartbeatAt: null,
      externalId: null,
    },
  })
}

async function markTaskEnqueued(taskId: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      enqueuedAt: new Date(),
      lastEnqueueError: null,
    },
  })
}

async function markTaskEnqueueFailed(taskId: string, error: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      enqueueAttempts: { increment: 1 },
      lastEnqueueError: error.slice(0, 500),
    },
  })
}

export async function recoverTasksOnWorkerStartup() {
  const processingTasks = await prisma.task.findMany({
    where: { status: TASK_STATUS.PROCESSING },
    select: {
      id: true,
      type: true,
      payload: true,
      billingInfo: true,
    },
  })

  const comfyUiProcessingTasks = processingTasks.filter((task) =>
    taskUsesComfyUiProvider({
      type: task.type,
      payload: task.payload,
      billingInfo: task.billingInfo,
    }))
  const resumableProcessingTaskIds = processingTasks
    .filter((task) => !comfyUiProcessingTasks.some((candidate) => candidate.id === task.id))
    .map((task) => task.id)

  for (const task of comfyUiProcessingTasks) {
    await abortLocalComfyUiTask(task.id)
  }

  if (resumableProcessingTaskIds.length > 0) {
    const resetResult = await prisma.task.updateMany({
      where: {
        id: { in: resumableProcessingTaskIds },
        status: TASK_STATUS.PROCESSING,
      },
      data: {
        status: TASK_STATUS.QUEUED,
        startedAt: null,
        heartbeatAt: null,
      },
    })
    if (resetResult.count > 0) {
      logger.info(`[StartupRecovery] Reset ${resetResult.count} processing tasks to queued`)
    }
  }

  if (comfyUiProcessingTasks.length > 0) {
    logger.info(`[StartupRecovery] Aborted ${comfyUiProcessingTasks.length} local ComfyUI processing tasks`)
  }

  const queuedTasks = await prisma.task.findMany({
    where: { status: TASK_STATUS.QUEUED },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      type: true,
      targetType: true,
      targetId: true,
      payload: true,
      billingInfo: true,
      priority: true,
    },
    orderBy: { createdAt: 'asc' },
    take: RE_ENQUEUE_BATCH_SIZE,
  })

  const comfyUiQueuedTasks = queuedTasks.filter((task) =>
    taskUsesComfyUiProvider({
      type: task.type,
      payload: task.payload,
      billingInfo: task.billingInfo,
    }))
  const resumableQueuedTasks = queuedTasks.filter((task) =>
    !comfyUiQueuedTasks.some((candidate) => candidate.id === task.id))

  for (const task of comfyUiQueuedTasks) {
    await abortLocalComfyUiTask(task.id)
  }

  if (comfyUiQueuedTasks.length > 0) {
    logger.info(`[StartupRecovery] Aborted ${comfyUiQueuedTasks.length} local ComfyUI queued tasks`)
  }

  let enqueued = 0
  let failed = 0

  for (const task of resumableQueuedTasks) {
    try {
      const taskType = toTaskType(task.type)
      if (!taskType) {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: TASK_STATUS.FAILED,
            errorCode: 'INVALID_TASK_TYPE',
            errorMessage: `invalid task type: ${String(task.type)}`,
            finishedAt: new Date(),
          },
        })
        failed += 1
        continue
      }

      const locale = resolveTaskLocaleFromPayload(task.payload)
      if (!locale) {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: TASK_STATUS.FAILED,
            errorCode: 'TASK_LOCALE_REQUIRED',
            errorMessage: 'task locale is missing',
            finishedAt: new Date(),
          },
        })
        failed += 1
        continue
      }

      const jobData: TaskJobData = {
        taskId: task.id,
        type: taskType,
        locale,
        projectId: task.projectId,
        episodeId: task.episodeId || null,
        targetType: task.targetType,
        targetId: task.targetId,
        payload: toTaskPayload(task.payload),
        billingInfo: toTaskBillingInfo(task.billingInfo),
        userId: task.userId,
        trace: null,
      }

      await addTaskJob(jobData, {
        priority: typeof task.priority === 'number' ? task.priority : 0,
      })
      await markTaskEnqueued(task.id)
      enqueued += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await markTaskEnqueueFailed(task.id, message || 're-enqueue failed')
      logger.error(`[StartupRecovery] Failed to re-enqueue task ${task.id}:`, message)
      failed += 1
    }
  }

  if (enqueued > 0) {
    logger.info(`[StartupRecovery] Re-enqueued ${enqueued} queued tasks`)
  }
  if (failed > 0) {
    logger.error(`[StartupRecovery] Failed to re-enqueue ${failed} tasks`)
  }
}
