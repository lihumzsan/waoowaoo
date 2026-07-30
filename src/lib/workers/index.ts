import { describeUnknownError } from '@/lib/errors/normalize'
import type { Job, Worker } from 'bullmq'
import { createScopedLogger } from '@/lib/logging/core'
import type { LogLevel } from '@/lib/logging/types'
import { installYunwuFetchTraceIfEnabled } from '@/lib/http/fetch-trace'
import type { TaskJobData } from '@/lib/task/types'
import type { OutboxJobData } from '@/lib/outbox/queue'
import { createImageWorker } from './image.worker'
import { createMusicWorker } from './music.worker'
import { createVoiceWorker } from './voice.worker'
import { createVideoWorker } from './video.worker'
import { createTextWorker } from './text.worker'
import { createOutboxWorker } from './outbox.worker'
import { startOutboxDispatcher } from '@/lib/outbox/dispatcher'
import { releaseInFlightTaskAttempts } from './attempt-recovery'

installYunwuFetchTraceIfEnabled()

const runtimeLogger = createScopedLogger({ module: 'workers.runtime' })

function runtimeDetails(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    pid: process.pid,
    ppid: process.ppid,
    uptimeMs: Math.round(process.uptime() * 1000),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    ...extra,
  }
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    const base = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
    if (typeof code === 'string') {
      return {
        ...base,
        code,
      }
    }
    return {
      ...base,
    }
  }
  return {
    name: typeof error,
    message: describeUnknownError(error),
  }
}

function jobDetails(job: Job<TaskJobData> | undefined | null, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    jobId: job?.id || null,
    taskId: job?.data?.taskId || null,
    taskType: job?.data?.type || null,
    projectId: job?.data?.projectId || null,
    episodeId: job?.data?.episodeId || null,
    targetType: job?.data?.targetType || null,
    targetId: job?.data?.targetId || null,
    failedReason: job?.failedReason || null,
    processedOn: job?.processedOn || null,
    finishedOn: job?.finishedOn || null,
    ...extra,
  }
}

const workers: Worker<TaskJobData>[] = [
  createImageWorker(),
  createVideoWorker(),
  createMusicWorker(),
  createVoiceWorker(),
  createTextWorker(),
]
const outboxWorker = createOutboxWorker()
startOutboxDispatcher()

runtimeLogger.info({
  action: 'workers.process.started',
  message: 'worker process started',
  details: runtimeDetails({
    workerCount: workers.length + 1,
    queues: [...workers.map((worker) => worker.name), outboxWorker.name],
  }),
})

type WorkerJobLogIdentity = {
  taskId?: string
  projectId?: string
  userId?: string
  jobFields: Record<string, unknown>
}

type WorkerEventLoggingSpec<TData> = {
  describeJob: (job: Job<TData> | undefined | null) => WorkerJobLogIdentity
  describeJobId: (jobId: string) => WorkerJobLogIdentity
  completedLevel: LogLevel
}

function attachWorkerEventLogging<TData>(worker: Worker<TData>, spec: WorkerEventLoggingSpec<TData>): void {
  worker.on('ready', () => {
    runtimeLogger.info({
      action: 'worker.ready',
      message: 'BullMQ worker ready',
      details: runtimeDetails({
        queue: worker.name,
      }),
    })
  })

  worker.on('error', (err) => {
    runtimeLogger.error({
      action: 'worker.error',
      message: 'BullMQ worker emitted error',
      details: runtimeDetails({
        queue: worker.name,
      }),
      error: errorDetails(err),
    })
  })

  worker.on('failed', (job, err, previousState) => {
    const identity = spec.describeJob(job)
    runtimeLogger.error({
      action: 'worker.job.failed_event',
      message: 'BullMQ job failed event emitted',
      taskId: identity.taskId,
      projectId: identity.projectId,
      userId: identity.userId,
      details: runtimeDetails({
        ...identity.jobFields,
        queue: worker.name,
        previousState: previousState || null,
      }),
      error: errorDetails(err),
    })
  })

  worker.on('stalled', (jobId, previousState) => {
    const identity = spec.describeJobId(jobId)
    runtimeLogger.error({
      action: 'worker.job.stalled',
      message: 'BullMQ job stalled; lock was not renewed before stalled detection',
      taskId: identity.taskId,
      details: runtimeDetails({
        ...identity.jobFields,
        queue: worker.name,
        previousState: previousState || null,
      }),
    })
  })

  worker.on('completed', (job) => {
    const identity = spec.describeJob(job)
    runtimeLogger.event({
      level: spec.completedLevel,
      action: 'worker.job.completed_event',
      message: 'BullMQ job completed event emitted',
      taskId: identity.taskId,
      projectId: identity.projectId,
      userId: identity.userId,
      details: runtimeDetails({
        ...identity.jobFields,
        queue: worker.name,
      }),
    })
  })
}

for (const worker of workers) {
  attachWorkerEventLogging<TaskJobData>(worker, {
    describeJob: (job) => ({
      taskId: job?.data?.taskId,
      projectId: job?.data?.projectId,
      userId: job?.data?.userId,
      jobFields: jobDetails(job),
    }),
    describeJobId: (jobId) => ({
      taskId: jobId,
      jobFields: { jobId },
    }),
    completedLevel: 'INFO',
  })
}

// Outbox jobs carry no taskId: the BullMQ jobId is the outboxId, so job fields
// are reported as-is instead of being coerced into task identity fields.
// completed stays at DEBUG because every delivered (including deferred) outbox
// command completes its job; INFO here would flood the log with routine traffic.
attachWorkerEventLogging<OutboxJobData>(outboxWorker, {
  describeJob: (job) => ({
    jobFields: {
      jobId: job?.id || null,
      outboxId: job?.data?.outboxId || null,
      failedReason: job?.failedReason || null,
      processedOn: job?.processedOn || null,
      finishedOn: job?.finishedOn || null,
    },
  }),
  describeJobId: (jobId) => ({
    jobFields: { jobId, outboxId: jobId },
  }),
  completedLevel: 'DEBUG',
})

let shuttingDown = false

// 优雅停机窗口：先给 in-flight job 一个短暂完成机会（graceful close 会等待活跃 job，
// 媒体轮询可长达数十分钟，不能无界等待）；超窗后放弃 attempt 归属而不标失败——
// 将 heartbeatAt 置空，让 BullMQ stalled 重投递到达时立即通过心跳接管恢复执行。
const WORKER_SHUTDOWN_JOB_GRACE_MS = 5_000

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  runtimeLogger.warn({
    action: 'workers.process.shutdown_signal',
    message: 'worker process received shutdown signal',
    details: runtimeDetails({ signal }),
  })
  try {
    const gracefulClose = Promise.all([...workers, outboxWorker].map(async (worker) => {
      runtimeLogger.info({
        action: 'worker.close.start',
        message: 'closing BullMQ worker',
        details: runtimeDetails({ queue: worker.name, signal }),
      })
      await worker.close()
      runtimeLogger.info({
        action: 'worker.close.completed',
        message: 'BullMQ worker closed',
        details: runtimeDetails({ queue: worker.name, signal }),
      })
    }))
    const closedInGrace = await Promise.race([
      gracefulClose.then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), WORKER_SHUTDOWN_JOB_GRACE_MS)
      }),
    ])
    if (!closedInGrace) {
      // 进程即将退出，被放弃的 close promise 不再消费；避免其晚到 rejection 触发 fatal 路径。
      gracefulClose.catch(() => {})
      const released = await releaseInFlightTaskAttempts()
      runtimeLogger.warn({
        action: 'workers.process.shutdown_released_attempts',
        message: 'graceful close exceeded the shutdown grace; released in-flight attempt ownership for immediate takeover on redelivery',
        details: runtimeDetails({ signal, released, graceMs: WORKER_SHUTDOWN_JOB_GRACE_MS }),
      })
    }
    process.exit(0)
  } catch (error) {
    runtimeLogger.error({
      action: 'workers.process.shutdown_failed',
      message: 'worker process shutdown failed',
      details: runtimeDetails({ signal }),
      error: errorDetails(error),
    })
    process.exit(1)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('beforeExit', (code) => {
  runtimeLogger.warn({
    action: 'workers.process.before_exit',
    message: 'worker process beforeExit emitted',
    details: runtimeDetails({ code }),
  })
})
process.on('exit', (code) => {
  runtimeLogger.warn({
    action: 'workers.process.exit',
    message: 'worker process exit emitted',
    details: runtimeDetails({ code }),
  })
})
process.on('uncaughtExceptionMonitor', (error) => {
  runtimeLogger.error({
    action: 'workers.process.uncaught_exception',
    message: 'worker process uncaught exception monitor observed an exception',
    details: runtimeDetails(),
    error: errorDetails(error),
  })
})
process.on('unhandledRejection', (reason) => {
  runtimeLogger.error({
    action: 'workers.process.unhandled_rejection',
    message: 'worker process unhandled rejection observed; rethrowing to preserve fatal behavior',
    details: runtimeDetails(),
    error: errorDetails(reason),
  })
  const error = reason instanceof Error ? reason : new Error(describeUnknownError(reason))
  setImmediate(() => {
    throw error
  })
})
