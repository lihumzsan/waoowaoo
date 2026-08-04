import { createScopedLogger } from '@/lib/logging/core'

const globalForInstrumentation = globalThis as typeof globalThis & {
  __waoowaooProcessCrashObserversInstalled?: boolean
}

function crashErrorDetails(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) }
}

export function installNodeProcessCrashObservers() {
  if (globalForInstrumentation.__waoowaooProcessCrashObserversInstalled) return

  globalForInstrumentation.__waoowaooProcessCrashObserversInstalled = true
  const processLogger = createScopedLogger({ module: 'next.runtime' })

  // Observe every uncaught exception without intercepting Node's fatal behavior.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    processLogger.error({
      action: 'server.process.uncaught_exception',
      message: 'next server process observed an uncaught exception',
      details: { origin, pid: process.pid },
      error: crashErrorDetails(error),
    })
  })

  // This observer is log-only; the active Node/Next rejection policy remains authoritative.
  process.on('unhandledRejection', (reason) => {
    processLogger.error({
      action: 'server.process.unhandled_rejection',
      message: 'next server process observed an unhandled promise rejection',
      details: { pid: process.pid },
      error: crashErrorDetails(reason),
    })
  })
}
