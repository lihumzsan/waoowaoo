import { TASK_TYPE, type QueueType, type TaskType } from './types'

export type TaskTargetTerminalProjector =
  | 'none'
  | 'edit_bible'
  | 'edit_style_preview'
  | 'video_group'
  | 'chapter_render'
  | 'final_video_render'
  | 'music_score'
  | 'soundscape'
  | 'edit_script'
  | 'edit_shot_execution_plan'

export type ImageTaskHandlerKey =
  | 'image_panel'
  | 'edit_style_preview'
  | 'image_character'
  | 'image_location'
  | 'regenerate_group'
  | 'modify_asset_image'
  | 'asset_hub_image'
  | 'asset_hub_modify'

export type VideoTaskHandlerKey = 'video_panel' | 'video_group' | 'final_video_render' | 'chapter_render'
export type MusicTaskHandlerKey = 'music_generate' | 'music_score' | 'soundscape_plan' | 'soundscape_generate'
export type TextTaskHandlerKey =
  | 'edit_bible_generate'
  | 'edit_style_preview_options_generate'
  | 'edit_script_generate'
  | 'edit_shot_execution_plan_generate'
  | 'asset_hub_ai_design'
  | 'asset_hub_ai_modify'
  | 'shot_ai'
  | 'reference_to_character'

type TaskHandlerByQueue = {
  image: ImageTaskHandlerKey
  video: VideoTaskHandlerKey
  music: MusicTaskHandlerKey
  text: TextTaskHandlerKey
}

export type TaskBillingPolicy = 'none' | 'text' | 'image' | 'video' | 'music' | 'sound_effect'
export type TaskExecutionProtocol = 'handler_result_checkpoint'
export type TaskTerminalSuccessHandoff = 'handler_result_checkpoint'
export type TaskSubmissionTargetOwnership = 'none' | 'chapter_render' | 'final_video_render'

export type TaskDefinition<Q extends QueueType = QueueType> = {
  queue: Q
  workerHandler: TaskHandlerByQueue[Q]
  billingPolicy: TaskBillingPolicy
  maxAttempts: number
  executionProtocol: TaskExecutionProtocol
  terminalSuccessHandoff: TaskTerminalSuccessHandoff
  submissionTargetOwnership: TaskSubmissionTargetOwnership
  terminalFailureProjector: TaskTargetTerminalProjector
  terminalCancelProjector: TaskTargetTerminalProjector
}

function definition<Q extends QueueType>(
  queue: Q,
  workerHandler: TaskHandlerByQueue[Q],
  billingPolicy: TaskBillingPolicy,
  maxAttempts: number,
  terminalFailureProjector: TaskTargetTerminalProjector,
  terminalCancelProjector: TaskTargetTerminalProjector,
  submissionTargetOwnership: TaskSubmissionTargetOwnership = 'none',
): TaskDefinition<Q> {
  return {
    queue,
    workerHandler,
    billingPolicy,
    maxAttempts,
    executionProtocol: 'handler_result_checkpoint',
    terminalSuccessHandoff: 'handler_result_checkpoint',
    submissionTargetOwnership,
    terminalFailureProjector,
    terminalCancelProjector,
  }
}

export const TASK_DEFINITIONS = {
  [TASK_TYPE.IMAGE_PANEL]: definition('image', 'image_panel', 'image', 3, 'none', 'none'),
  [TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE]: definition('text', 'edit_style_preview_options_generate', 'text', 3, 'none', 'none'),
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: definition('image', 'edit_style_preview', 'image', 3, 'edit_style_preview', 'edit_style_preview'),
  [TASK_TYPE.IMAGE_CHARACTER]: definition('image', 'image_character', 'image', 3, 'none', 'none'),
  [TASK_TYPE.IMAGE_LOCATION]: definition('image', 'image_location', 'image', 3, 'none', 'none'),
  [TASK_TYPE.MUSIC_GENERATE]: definition('music', 'music_generate', 'music', 3, 'none', 'none'),
  [TASK_TYPE.MUSIC_SCORE_PLAN]: definition('music', 'music_score', 'music', 3, 'music_score', 'music_score'),
  [TASK_TYPE.SOUNDSCAPE_PLAN]: definition('music', 'soundscape_plan', 'text', 3, 'soundscape', 'soundscape'),
  [TASK_TYPE.SOUNDSCAPE_GENERATE]: definition('music', 'soundscape_generate', 'sound_effect', 3, 'soundscape', 'soundscape'),
  [TASK_TYPE.FINAL_VIDEO_RENDER]: definition('video', 'final_video_render', 'none', 1, 'final_video_render', 'final_video_render', 'final_video_render'),
  [TASK_TYPE.CHAPTER_RENDER]: definition('video', 'chapter_render', 'none', 1, 'chapter_render', 'chapter_render', 'chapter_render'),
  [TASK_TYPE.VIDEO_PANEL]: definition('video', 'video_panel', 'video', 3, 'none', 'none'),
  [TASK_TYPE.VIDEO_GROUP]: definition('video', 'video_group', 'video', 3, 'video_group', 'video_group'),
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: definition('image', 'modify_asset_image', 'image', 3, 'none', 'none'),
  [TASK_TYPE.REGENERATE_GROUP]: definition('image', 'regenerate_group', 'image', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_IMAGE]: definition('image', 'asset_hub_image', 'image', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_MODIFY]: definition('image', 'asset_hub_modify', 'image', 3, 'none', 'none'),
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: definition('text', 'edit_bible_generate', 'text', 3, 'edit_bible', 'edit_bible'),
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: definition('text', 'edit_bible_generate', 'text', 3, 'edit_bible', 'edit_bible'),
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: definition('text', 'edit_script_generate', 'text', 3, 'edit_script', 'edit_script'),
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: definition('text', 'edit_shot_execution_plan_generate', 'text', 3, 'edit_shot_execution_plan', 'edit_shot_execution_plan'),
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: definition('text', 'shot_ai', 'text', 3, 'none', 'none'),
  [TASK_TYPE.AI_MODIFY_LOCATION]: definition('text', 'shot_ai', 'text', 3, 'none', 'none'),
  [TASK_TYPE.AI_MODIFY_PROP]: definition('text', 'shot_ai', 'text', 3, 'none', 'none'),
  [TASK_TYPE.AI_CREATE_CHARACTER]: definition('text', 'asset_hub_ai_design', 'text', 3, 'none', 'none'),
  [TASK_TYPE.AI_CREATE_LOCATION]: definition('text', 'asset_hub_ai_design', 'text', 3, 'none', 'none'),
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: definition('text', 'reference_to_character', 'image', 3, 'none', 'none'),
  [TASK_TYPE.REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: definition('text', 'reference_to_character', 'text', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: definition('text', 'asset_hub_ai_design', 'text', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: definition('text', 'asset_hub_ai_design', 'text', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: definition('text', 'asset_hub_ai_modify', 'text', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: definition('text', 'asset_hub_ai_modify', 'text', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: definition('text', 'asset_hub_ai_modify', 'text', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: definition('text', 'reference_to_character', 'image', 3, 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: definition('text', 'reference_to_character', 'text', 3, 'none', 'none'),
} satisfies Record<TaskType, TaskDefinition>

export function getTaskDefinition(type: TaskType): TaskDefinition {
  const taskDefinition = TASK_DEFINITIONS[type] as TaskDefinition | undefined
  if (!taskDefinition) throw new Error(`TASK_DEFINITION_MISSING:${String(type)}`)
  return taskDefinition
}

export function getTaskDefinitionForQueue<Q extends QueueType>(type: TaskType, queue: Q): TaskDefinition<Q> {
  const taskDefinition = getTaskDefinition(type)
  if (taskDefinition.queue !== queue) {
    throw new Error(`TASK_QUEUE_MISMATCH:${type}:${taskDefinition.queue}:${queue}`)
  }
  return taskDefinition as TaskDefinition<Q>
}
