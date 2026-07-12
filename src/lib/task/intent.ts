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
  [TASK_TYPE.IMAGE_PANEL]: 'generate',
  [TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE]: 'generate',
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: 'generate',
  [TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN]: 'generate',
  [TASK_TYPE.IMAGE_CHARACTER]: 'generate',
  [TASK_TYPE.IMAGE_LOCATION]: 'generate',
  [TASK_TYPE.MUSIC_GENERATE]: 'generate',
  [TASK_TYPE.MUSIC_SCORE_PLAN]: 'generate',
  [TASK_TYPE.SOUNDSCAPE_PLAN]: 'generate',
  [TASK_TYPE.SOUNDSCAPE_GENERATE]: 'generate',
  [TASK_TYPE.FINAL_VIDEO_RENDER]: 'process',
  [TASK_TYPE.CHAPTER_RENDER]: 'process',
  [TASK_TYPE.VIDEO_PANEL]: 'generate',
  [TASK_TYPE.VIDEO_GROUP]: 'generate',
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: 'modify',
  [TASK_TYPE.REGENERATE_GROUP]: 'regenerate',
  [TASK_TYPE.ASSET_HUB_IMAGE]: 'generate',
  [TASK_TYPE.ASSET_HUB_MODIFY]: 'modify',
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: 'generate',
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: 'generate',
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: 'generate',
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: 'generate',
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: 'modify',
  [TASK_TYPE.AI_MODIFY_LOCATION]: 'modify',
  [TASK_TYPE.AI_MODIFY_PROP]: 'modify',
  [TASK_TYPE.AI_CREATE_CHARACTER]: 'generate',
  [TASK_TYPE.AI_CREATE_LOCATION]: 'generate',
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: 'process',
  [TASK_TYPE.REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: 'process',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: 'generate',
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: 'generate',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: 'modify',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: 'modify',
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: 'modify',
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: 'process',
  [TASK_TYPE.ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: 'process',
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
