import { ERROR_FAILURE_CLASS, type ErrorFailureClass } from '@/lib/errors/codes'
import { isLLMTaskType } from '@/lib/llm-observe/task-policy'
import { TASK_TYPE, type TaskType } from './types'

export const TASK_RETRY_BACKOFF_BASE_MS = 15_000

const DEFAULT_TASK_MAX_ATTEMPTS = 3

const TASK_MAX_ATTEMPTS_OPT_OUT: Partial<Record<TaskType, number>> = {
  [TASK_TYPE.FINAL_VIDEO_RENDER]: 1,
  [TASK_TYPE.CHAPTER_RENDER]: 1,
}

export function getTaskMaxAttempts(type: TaskType): number {
  return TASK_MAX_ATTEMPTS_OPT_OUT[type] ?? DEFAULT_TASK_MAX_ATTEMPTS
}

export function shouldRetryTaskFailure(input: {
  readonly taskType: TaskType
  readonly failureClass: ErrorFailureClass
}): boolean {
  if (input.failureClass === ERROR_FAILURE_CLASS.TRANSIENT_PROVIDER) return true
  return input.failureClass === ERROR_FAILURE_CLASS.OUTPUT_VALIDATION
    && isLLMTaskType(input.taskType)
}
