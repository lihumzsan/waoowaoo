import 'dotenv/config'
import type { Job, Worker } from 'bullmq'
import { createScopedLogger } from '@/lib/logging/core'
import { installYunwuFetchTraceIfEnabled } from '@/lib/http/fetch-trace'
import type { TaskJobData } from '@/lib/task/types'
import { createImageWorker } from './image.worker'
import { createMusicWorker } from './music.worker'
import { createVideoWorker } from './video.worker'
import { createTextWorker } from './text.worker'

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
    message: String(error),
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
    attemptsMade: job?.attemptsMade ?? null,
    failedReason: job?.failedReason || null,
    processedOn: job?.processedOn || null,
    finishedOn: job?.finishedOn || null,
    ...extra,
  }
}

const workers: Worker<TaskJobData>[] = [createImageWorker(), createVideoWorker(), createMusicWorker(), createTextWorker()]

runtimeLogger.info({
  action: 'workers.process.started',
  message: 'worker process started',
  details: runtimeDetails({
    workerCount: workers.length,
    queues: workers.map((worker) => worker.name),
  }),
})

for (const worker of workers) {
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
    runtimeLogger.error({
      action: 'worker.job.failed_event',
      message: 'BullMQ job failed event emitted',
      taskId: job?.data?.taskId,
      projectId: job?.data?.projectId,
      userId: job?.data?.userId,
      details: runtimeDetails(jobDetails(job, {
        queue: worker.name,
        previousState: previousState || null,
      })),
      error: errorDetails(err),
    })
  })

  worker.on('stalled', (jobId, previousState) => {
    runtimeLogger.error({
      action: 'worker.job.stalled',
      message: 'BullMQ job stalled; lock was not renewed before stalled detection',
      taskId: jobId,
      details: runtimeDetails({
        queue: worker.name,
        jobId,
        previousState: previousState || null,
      }),
    })
  })

  worker.on('completed', (job) => {
    runtimeLogger.info({
      action: 'worker.job.completed_event',
      message: 'BullMQ job completed event emitted',
      taskId: job.data.taskId,
      projectId: job.data.projectId,
      userId: job.data.userId,
      details: runtimeDetails(jobDetails(job, {
        queue: worker.name,
      })),
    })
  })
}

let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  runtimeLogger.warn({
    action: 'workers.process.shutdown_signal',
    message: 'worker process received shutdown signal',
    details: runtimeDetails({ signal }),
  })
  try {
    await Promise.all(workers.map(async (worker) => {
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
  const error = reason instanceof Error ? reason : new Error(String(reason))
  setImmediate(() => {
    throw error
  })
})
