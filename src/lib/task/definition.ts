import { TASK_TYPE, type QueueType, type TaskType } from './types'
import type { WorkspaceResourceImpact } from '@/lib/workspace-resource/resource-impact'

export type TaskTargetTerminalProjector =
  | 'none'
  | 'edit_bible'
  | 'edit_style_preview'
  | 'video_segment'
  | 'chapter_render'
  | 'final_video_render'
  | 'music_score'
  | 'ambient_sound'
  | 'edit_script'
  | 'edit_shot_execution_plan'

export type ImageTaskHandlerKey =
  | 'edit_style_preview'
  | 'image_character'
  | 'image_location'
  | 'regenerate_group'
  | 'modify_asset_image'
  | 'asset_hub_image'
  | 'asset_hub_modify'

export type VideoTaskHandlerKey = 'video_segment' | 'final_video_render' | 'chapter_render'
export type MusicTaskHandlerKey = 'music_generate' | 'music_score_generate' | 'ambient_sound_plan' | 'ambient_sound_generate'
export type TextTaskHandlerKey =
  | 'music_score_plan'
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
  terminalResourceImpact: WorkspaceResourceImpact
  terminalFailureProjector: TaskTargetTerminalProjector
  terminalCancelProjector: TaskTargetTerminalProjector
}

function definition<Q extends QueueType>(
  queue: Q,
  workerHandler: TaskHandlerByQueue[Q],
  billingPolicy: TaskBillingPolicy,
  maxAttempts: number,
  terminalResourceImpact: WorkspaceResourceImpact,
  terminalFailureProjector: TaskTargetTerminalProjector,
  terminalCancelProjector: TaskTargetTerminalProjector,
  submissionTargetOwnership: TaskSubmissionTargetOwnership,
): TaskDefinition<Q> {
  return {
    queue,
    workerHandler,
    billingPolicy,
    maxAttempts,
    executionProtocol: 'handler_result_checkpoint',
    terminalSuccessHandoff: 'handler_result_checkpoint',
    submissionTargetOwnership,
    terminalResourceImpact,
    terminalFailureProjector,
    terminalCancelProjector,
  }
}

export const TASK_DEFINITIONS = {
  [TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE]: definition('text', 'edit_style_preview_options_generate', 'text', 3, 'edit_style_preview', 'none', 'none', 'none'),
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: definition('image', 'edit_style_preview', 'image', 3, 'edit_style_preview', 'edit_style_preview', 'edit_style_preview', 'none'),
  [TASK_TYPE.IMAGE_CHARACTER]: definition('image', 'image_character', 'image', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.IMAGE_LOCATION]: definition('image', 'image_location', 'image', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.MUSIC_GENERATE]: definition('music', 'music_generate', 'music', 3, 'none', 'none', 'none', 'none'),
  [TASK_TYPE.MUSIC_SCORE_PLAN]: definition('text', 'music_score_plan', 'text', 3, 'episode', 'music_score', 'music_score', 'none'),
  [TASK_TYPE.MUSIC_SCORE_GENERATE]: definition('music', 'music_score_generate', 'music', 3, 'episode', 'music_score', 'music_score', 'none'),
  [TASK_TYPE.AMBIENT_SOUND_PLAN]: definition('music', 'ambient_sound_plan', 'text', 3, 'episode', 'ambient_sound', 'ambient_sound', 'none'),
  [TASK_TYPE.AMBIENT_SOUND_GENERATE]: definition('music', 'ambient_sound_generate', 'sound_effect', 3, 'episode', 'ambient_sound', 'ambient_sound', 'none'),
  [TASK_TYPE.FINAL_VIDEO_RENDER]: definition('video', 'final_video_render', 'none', 1, 'video_segments', 'final_video_render', 'final_video_render', 'final_video_render'),
  [TASK_TYPE.CHAPTER_RENDER]: definition('video', 'chapter_render', 'none', 1, 'video_segments', 'chapter_render', 'chapter_render', 'chapter_render'),
  [TASK_TYPE.VIDEO_SEGMENT]: definition('video', 'video_segment', 'video', 3, 'video_segments', 'video_segment', 'video_segment', 'none'),
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: definition('image', 'modify_asset_image', 'image', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.REGENERATE_GROUP]: definition('image', 'regenerate_group', 'image', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_IMAGE]: definition('image', 'asset_hub_image', 'image', 3, 'global_assets', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_MODIFY]: definition('image', 'asset_hub_modify', 'image', 3, 'global_assets', 'none', 'none', 'none'),
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: definition('text', 'edit_bible_generate', 'text', 3, 'edit_pipeline', 'edit_bible', 'edit_bible', 'none'),
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: definition('text', 'edit_bible_generate', 'text', 3, 'edit_pipeline', 'edit_bible', 'edit_bible', 'none'),
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: definition('text', 'edit_script_generate', 'text', 3, 'edit_pipeline', 'edit_script', 'edit_script', 'none'),
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: definition('text', 'edit_shot_execution_plan_generate', 'text', 3, 'edit_pipeline', 'edit_shot_execution_plan', 'edit_shot_execution_plan', 'none'),
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: definition('text', 'shot_ai', 'text', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.AI_MODIFY_LOCATION]: definition('text', 'shot_ai', 'text', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.AI_MODIFY_PROP]: definition('text', 'shot_ai', 'text', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.AI_CREATE_CHARACTER]: definition('text', 'asset_hub_ai_design', 'text', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.AI_CREATE_LOCATION]: definition('text', 'asset_hub_ai_design', 'text', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: definition('text', 'reference_to_character', 'image', 3, 'project_assets', 'none', 'none', 'none'),
  [TASK_TYPE.REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: definition('text', 'reference_to_character', 'text', 3, 'none', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: definition('text', 'asset_hub_ai_design', 'text', 3, 'global_assets', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: definition('text', 'asset_hub_ai_design', 'text', 3, 'global_assets', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: definition('text', 'asset_hub_ai_modify', 'text', 3, 'global_assets', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: definition('text', 'asset_hub_ai_modify', 'text', 3, 'global_assets', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: definition('text', 'asset_hub_ai_modify', 'text', 3, 'global_assets', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: definition('text', 'reference_to_character', 'image', 3, 'global_assets', 'none', 'none', 'none'),
  [TASK_TYPE.ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: definition('text', 'reference_to_character', 'text', 3, 'none', 'none', 'none', 'none'),
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
