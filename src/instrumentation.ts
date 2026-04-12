// Next.js instrumentation intentionally stays lightweight.
// Queue recovery now runs from the dedicated worker process startup so
// local ComfyUI task policy does not affect web-server boot.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return
  }
}
