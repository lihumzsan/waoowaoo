import type { FailureRecord } from '@/lib/errors/failure'
import type { TaskType } from './types'
import { getTaskDefinition } from './definition'

export const TASK_RETRY_BACKOFF_BASE_MS = 15_000

export function getTaskMaxAttempts(type: TaskType): number {
  return getTaskDefinition(type).maxAttempts
}

/** Replay permission comes only from the operation contract/effect fact. */
export function shouldRetryTaskFailure(input: {
  readonly failure: FailureRecord
}): boolean {
  return input.failure.recovery.taskReplay === 'safe'
}
