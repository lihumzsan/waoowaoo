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
