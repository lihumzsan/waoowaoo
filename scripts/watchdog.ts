import { config as loadEnv } from 'dotenv'
import type { TaskType } from '@/lib/task/types'

// Force local scripts to honor the checked-in .env even when the parent shell
// still carries an older DATABASE_URL (for example a prisma:// proxy URL).
loadEnv({ path: '.env', override: true })

type Logger = {
  info(payload: Record<string, unknown>): void
  warn(payload: Record<string, unknown>): void
  error(payload: Record<string, unknown>): void
}

let logger: Logger
let prisma: typeof import('@/lib/prisma')['prisma']
let addTaskJob: typeof import('@/lib/task/queues')['addTaskJob']
let resolveTaskLocaleFromBody: typeof import('@/lib/task/resolve-locale')['resolveTaskLocaleFromBody']
let markTaskFailed: typeof import('@/lib/task/service')['markTaskFailed']
let publishTaskEvent: typeof import('@/lib/task/publisher')['publishTaskEvent']
let TASK_EVENT_TYPE: typeof import('@/lib/task/types')['TASK_EVENT_TYPE']
let TASK_TYPE: typeof import('@/lib/task/types')['TASK_TYPE']
let cleanupAllProjectLogs: typeof import('@/lib/logging/file-writer')['cleanupAllProjectLogs']

const INTERVAL_MS = Number.parseInt(process.env.WATCHDOG_INTERVAL_MS || '30000', 10) || 30000
const HEARTBEAT_TIMEOUT_MS = Number.parseInt(process.env.TASK_HEARTBEAT_TIMEOUT_MS || '90000', 10) || 90000
let TASK_TYPE_SET: ReadonlySet<string> = new Set()
// 姣忓皬鏃舵墽琛屼竴娆℃棩蹇楁竻鐞?
const LOG_CLEANUP_INTERVAL_TICKS = Math.ceil(3600_000 / INTERVAL_MS)
let tickCount = 0

function toTaskType(value: string): TaskType | null {
  if (TASK_TYPE_SET.has(value)) {
    return value as TaskType
  }
  return null
}

function toTaskPayload(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

async function recoverQueuedTasks() {
  const rows = await prisma.task.findMany({
    where: {
      status: 'queued',
      enqueuedAt: null,
    },
    take: 100,
    orderBy: { createdAt: 'asc' },
  })

  for (const task of rows) {
    const taskType = toTaskType(task.type)
    if (!taskType) {
      logger.error({
        action: 'watchdog.reenqueue_invalid_type',
        message: `invalid task type: ${task.type}`,
        taskId: task.id,
        projectId: task.projectId,
        userId: task.userId,
        errorCode: 'INVALID_PARAMS',
        retryable: false,
      })
      continue
    }
    try {
      const locale = resolveTaskLocaleFromBody(task.payload)
      if (!locale) {
        await markTaskFailed(task.id, 'TASK_LOCALE_REQUIRED', 'task locale is missing')
        logger.error({
          action: 'watchdog.reenqueue_locale_missing',
          message: 'task locale is missing',
          taskId: task.id,
          projectId: task.projectId,
          userId: task.userId,
          errorCode: 'TASK_LOCALE_REQUIRED',
          retryable: false,
        })
        continue
      }

      await addTaskJob({
        taskId: task.id,
        type: taskType,
        locale,
        projectId: task.projectId,
        episodeId: task.episodeId,
        targetType: task.targetType,
        targetId: task.targetId,
        payload: toTaskPayload(task.payload),
        userId: task.userId,
      })
      await prisma.task.update({
        where: { id: task.id },
        data: {
          enqueuedAt: new Date(),
          enqueueAttempts: { increment: 1 },
          lastEnqueueError: null,
        },
      })
      logger.info({
        action: 'watchdog.reenqueue',
        message: 'watchdog re-enqueued queued task',
        taskId: task.id,
        projectId: task.projectId,
        userId: task.userId,
        details: {
          type: task.type,
          targetType: task.targetType,
          targetId: task.targetId,
        },
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 're-enqueue failed'
      await prisma.task.update({
        where: { id: task.id },
        data: {
          enqueueAttempts: { increment: 1 },
          lastEnqueueError: message,
        },
      })
      logger.error({
        action: 'watchdog.reenqueue_failed',
        message,
        taskId: task.id,
        projectId: task.projectId,
        userId: task.userId,
        errorCode: 'EXTERNAL_ERROR',
        retryable: true,
      })
    }
  }
}

async function cleanupZombieProcessingTasks() {
  const timeoutAt = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS)
  const rows = await prisma.task.findMany({
    where: {
      status: 'processing',
      heartbeatAt: { lt: timeoutAt },
    },
    take: 100,
  })

  for (const task of rows) {
    if ((task.attempt || 0) >= (task.maxAttempts || 5)) {
      await markTaskFailed(task.id, 'WATCHDOG_TIMEOUT', 'Task heartbeat timeout')
      await publishTaskEvent({
        taskId: task.id,
        projectId: task.projectId,
        userId: task.userId,
        type: TASK_EVENT_TYPE.FAILED,
        payload: { reason: 'watchdog_timeout' },
      })
      logger.error({
        action: 'watchdog.fail_timeout',
        message: 'watchdog marked task as failed due to heartbeat timeout',
        taskId: task.id,
        projectId: task.projectId,
        userId: task.userId,
        errorCode: 'WATCHDOG_TIMEOUT',
        retryable: true,
      })
      continue
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'queued',
        enqueuedAt: null,
        heartbeatAt: null,
        startedAt: null,
      },
    })
    await publishTaskEvent({
      taskId: task.id,
      projectId: task.projectId,
      userId: task.userId,
      type: TASK_EVENT_TYPE.CREATED,
      payload: { reason: 'watchdog_requeue' },
    })
    logger.warn({
      action: 'watchdog.requeue_processing',
      message: 'watchdog re-queued stalled processing task',
      taskId: task.id,
      projectId: task.projectId,
      userId: task.userId,
      retryable: true,
    })
  }
}

async function tick() {
  tickCount += 1
  const startedAt = Date.now()
  try {
    await recoverQueuedTasks()
    await cleanupZombieProcessingTasks()
    if (tickCount % LOG_CLEANUP_INTERVAL_TICKS === 0) {
      void cleanupAllProjectLogs()
    }
    logger.info({
      action: 'watchdog.tick.ok',
      message: 'watchdog tick completed',
      durationMs: Date.now() - startedAt,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'watchdog tick failed'
    logger.error({
      action: 'watchdog.tick.failed',
      message,
      durationMs: Date.now() - startedAt,
      errorCode: 'INTERNAL_ERROR',
      retryable: true,
    })
  }
}

async function bootstrap() {
  const [
    loggingCore,
    prismaModule,
    taskQueues,
    resolveLocaleModule,
    taskService,
    taskPublisher,
    taskTypes,
    fileWriter,
  ] = await Promise.all([
    import('@/lib/logging/core'),
    import('@/lib/prisma'),
    import('@/lib/task/queues'),
    import('@/lib/task/resolve-locale'),
    import('@/lib/task/service'),
    import('@/lib/task/publisher'),
    import('@/lib/task/types'),
    import('@/lib/logging/file-writer'),
  ])

  logger = loggingCore.createScopedLogger({
    module: 'watchdog',
    action: 'watchdog.tick',
  })
  prisma = prismaModule.prisma
  addTaskJob = taskQueues.addTaskJob
  resolveTaskLocaleFromBody = resolveLocaleModule.resolveTaskLocaleFromBody
  markTaskFailed = taskService.markTaskFailed
  publishTaskEvent = taskPublisher.publishTaskEvent
  TASK_EVENT_TYPE = taskTypes.TASK_EVENT_TYPE
  TASK_TYPE = taskTypes.TASK_TYPE
  TASK_TYPE_SET = new Set(Object.values(TASK_TYPE))
  cleanupAllProjectLogs = fileWriter.cleanupAllProjectLogs

  logger.info({
    action: 'watchdog.started',
    message: 'watchdog started',
    details: {
      intervalMs: INTERVAL_MS,
      heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
    },
  })

  await tick()
  setInterval(() => {
    void tick()
  }, INTERVAL_MS)
}

void bootstrap()
