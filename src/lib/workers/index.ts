import 'dotenv/config'
import { logInfo as logInfo, logError as logError } from '@/lib/logging/core'
import { recoverTasksOnWorkerStartup } from '@/lib/task/startup-recovery'
import { createImageWorker } from './image.worker'
import { createVideoWorker } from './video.worker'
import { createVoiceWorker } from './voice.worker'
import { createTextWorker } from './text.worker'

async function start() {
  try {
    await recoverTasksOnWorkerStartup()
  } catch (error) {
    logError('[Workers] startup recovery failed', error instanceof Error ? error.message : String(error))
  }

  const workers = [createImageWorker(), createVideoWorker(), createVoiceWorker(), createTextWorker()]

  logInfo('[Workers] started:', workers.length)

  for (const worker of workers) {
    worker.on('ready', () => {
      logInfo(`[Workers] ready: ${worker.name}`)
    })

    worker.on('error', (err) => {
      logError(`[Workers] error: ${worker.name}`, err.message)
    })

    worker.on('failed', (job, err) => {
      logError(`[Workers] job failed: ${worker.name}`, {
        jobId: job?.id,
        taskId: job?.data?.taskId,
        taskType: job?.data?.type,
        error: err.message,
      })
    })
  }

  async function shutdown(signal: string) {
    logInfo(`[Workers] shutdown signal: ${signal}`)
    await Promise.all(workers.map(async (worker) => await worker.close()))
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void start()
