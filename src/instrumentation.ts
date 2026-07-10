// Next.js Instrumentation - runs once when the Node.js server starts.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { logInfo, logError } = await import('@/lib/logging/core')
  try {
    const { startTaskReconciler } = await import('@/lib/task/reconcile')
    startTaskReconciler()
    logInfo('[Instrumentation] Task reconciler started')
  } catch (error) {
    logError('[Instrumentation] Failed to start task reconciler:', error)
    throw error
  }
}
