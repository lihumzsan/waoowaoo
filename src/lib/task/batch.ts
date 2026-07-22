import { randomUUID } from 'crypto'

export function createTaskBatchKey(prefix: string): string {
  const normalizedPrefix = prefix.trim()
  if (!normalizedPrefix) throw new Error('TASK_BATCH_PREFIX_REQUIRED')
  return `${normalizedPrefix}:${randomUUID()}`
}
