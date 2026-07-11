const DEFAULT_IMAGE_QUEUE_GLOBAL_CONCURRENCY = 10

export function readImageQueueGlobalConcurrency(raw?: string): number {
  const normalized = raw?.trim() || ''
  if (!/^\d+$/.test(normalized)) return DEFAULT_IMAGE_QUEUE_GLOBAL_CONCURRENCY
  const parsed = Number.parseInt(normalized, 10)
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_IMAGE_QUEUE_GLOBAL_CONCURRENCY
}
