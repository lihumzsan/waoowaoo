// Next.js instrumentation is compiled for both Node.js and Edge runtimes.
// Keep Node-only APIs behind the runtime-specific dynamic import.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { installNodeProcessCrashObservers } = await import('./instrumentation-node')
  installNodeProcessCrashObservers()
}
