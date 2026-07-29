// Next.js Instrumentation - runs once when the Node.js server starts.

const globalForInstrumentation = globalThis as typeof globalThis & {
  __waoowaooProcessCrashObserversInstalled?: boolean
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { createScopedLogger, logInfo, logError } = await import('@/lib/logging/core')

  if (!globalForInstrumentation.__waoowaooProcessCrashObserversInstalled) {
    globalForInstrumentation.__waoowaooProcessCrashObserversInstalled = true
    const processLogger = createScopedLogger({ module: 'next.runtime' })
    const crashErrorDetails = (error: unknown) => error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) }
    // uncaughtExceptionMonitor observes every uncaught exception without
    // intercepting the default fatal behavior, and survives Next's own
    // removeAllListeners('uncaughtException') handler swap in next-server.
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      processLogger.error({
        action: 'server.process.uncaught_exception',
        message: 'next server process observed an uncaught exception',
        details: { origin, pid: process.pid },
        error: crashErrorDetails(error),
      })
    })
    // Log-only observer; it does not rethrow, so whichever unhandledRejection
    // policy is active (Node default or Next's own handler) stays authoritative.
    // Boundary: if Next later calls removeAllListeners('unhandledRejection'),
    // this listener is dropped; fatal rejections then still surface through the
    // uncaughtExceptionMonitor above when the default throw policy applies.
    process.on('unhandledRejection', (reason) => {
      processLogger.error({
        action: 'server.process.unhandled_rejection',
        message: 'next server process observed an unhandled promise rejection',
        details: { pid: process.pid },
        error: crashErrorDetails(reason),
      })
    })
  }

  try {
    const { startTaskReconciler } = await import('@/lib/task/reconcile')
    startTaskReconciler()
    logInfo('[Instrumentation] Task reconciler started')
  } catch (error) {
    logError('[Instrumentation] Failed to start task reconciler:', error)
    throw error
  }
}
