import { TASK_TYPE, type TaskType } from './types'

export type TaskIntent =
  | 'generate'
  | 'regenerate'
  | 'modify'
  | 'analyze'
  | 'build'
  | 'convert'
  | 'process'

export const TASK_INTENTS: TaskIntent[] = [
  'generate',
  'regenerate',
  'modify',
  'analyze',
  'build',
  'convert',
  'process',
]

const TASK_INTENT_SET = new Set<string>(TASK_INTENTS)

const TASK_INTENT_BY_TYPE: Record<TaskType, TaskIntent> = {
  [TASK_TYPE.WORKSPACE_RESOURCE_IMAGE]: 'generate',
  [TASK_TYPE.WORKSPACE_RESOURCE_AUDIO]: 'generate',
  [TASK_TYPE.WORKSPACE_RESOURCE_VOICE]: 'generate',
  [TASK_TYPE.WORKSPACE_RESOURCE_VIDEO]: 'generate',
  [TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE]: 'process',
}

export function resolveTaskIntent(taskType: string | null | undefined): TaskIntent {
  if (!taskType) return 'process'
  if (taskType in TASK_INTENT_BY_TYPE) {
    return TASK_INTENT_BY_TYPE[taskType as TaskType]
  }
  return 'process'
}

export function isTaskIntent(value: unknown): value is TaskIntent {
  return typeof value === 'string' && TASK_INTENT_SET.has(value)
}

export function coerceTaskIntent(value: unknown, fallbackTaskType?: string | null): TaskIntent {
  if (isTaskIntent(value)) return value
  return resolveTaskIntent(fallbackTaskType)
}
