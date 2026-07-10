import { cleanupAllProjectLogs } from '@/lib/logging/file-writer'
import { createScopedLogger } from '@/lib/logging/core'

const DEFAULT_INTERVAL_MS = 60 * 60_000
const configuredInterval = Number.parseInt(process.env.LOG_CLEANUP_INTERVAL_MS || '', 10)
const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
  ? configuredInterval
  : DEFAULT_INTERVAL_MS
const logger = createScopedLogger({ module: 'log.cleanup' })

async function cleanup(): Promise<void> {
  try {
    await cleanupAllProjectLogs()
    logger.info({
      action: 'log.cleanup.completed',
      message: 'Project log cleanup completed',
    })
  } catch (error) {
    logger.error({
      action: 'log.cleanup.failed',
      message: 'Project log cleanup failed',
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
    })
  }
}

logger.info({
  action: 'log.cleanup.started',
  message: 'Project log cleanup scheduler started',
  details: { intervalMs },
})

setInterval(() => {
  void cleanup()
}, intervalMs)
