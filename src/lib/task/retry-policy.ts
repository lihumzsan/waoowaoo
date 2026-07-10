import { ERROR_FAILURE_CLASS, type ErrorFailureClass } from '@/lib/errors/codes'
import { isLLMTaskType } from '@/lib/llm-observe/task-policy'
import type { TaskType } from './types'
import { getTaskDefinition } from './definition'

export const TASK_RETRY_BACKOFF_BASE_MS = 15_000

export function getTaskMaxAttempts(type: TaskType): number {
  return getTaskDefinition(type).maxAttempts
}

export function shouldRetryTaskFailure(input: {
  readonly taskType: TaskType
  readonly failureClass: ErrorFailureClass
}): boolean {
  if (input.failureClass === ERROR_FAILURE_CLASS.TRANSIENT_PROVIDER) return true
  return input.failureClass === ERROR_FAILURE_CLASS.OUTPUT_VALIDATION
    && isLLMTaskType(input.taskType)
}
