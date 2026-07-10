import { TASK_TYPE, type QueueType, type TaskType } from './types'

export type TaskTargetTerminalProjector =
  | 'none'
  | 'edit_bible'
  | 'edit_style_preview'
  | 'video_group'
  | 'chapter_render'
  | 'final_video_render'

export type TaskExecutionProtocol = 'handler_result_checkpoint'
export type TaskTerminalSuccessHandoff = 'handler_result_checkpoint'

export type TaskDefinition = {
  queue: QueueType
  maxAttempts: number
  executionProtocol: TaskExecutionProtocol
  terminalSuccessHandoff: TaskTerminalSuccessHandoff
  terminalFailureProjector: TaskTargetTerminalProjector
  terminalCancelProjector: TaskTargetTerminalProjector
}

function definition(input: TaskDefinition): TaskDefinition {
  return input
}

const NONE = {
  terminalSuccessHandoff: 'handler_result_checkpoint',
  terminalFailureProjector: 'none',
  terminalCancelProjector: 'none',
} as const

const target = (projector: Exclude<TaskTargetTerminalProjector, 'none'>) => ({
  terminalSuccessHandoff: 'handler_result_checkpoint' as const,
  terminalFailureProjector: projector,
  terminalCancelProjector: projector,
})

export const TASK_DEFINITIONS = {
  [TASK_TYPE.IMAGE_PANEL]: definition({ queue: 'image', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: definition({ queue: 'image', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...target('edit_style_preview') }),
  [TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.IMAGE_CHARACTER]: definition({ queue: 'image', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.IMAGE_LOCATION]: definition({ queue: 'image', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.MUSIC_GENERATE]: definition({ queue: 'music', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.MUSIC_SCORE_PLAN]: definition({ queue: 'music', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.SOUNDSCAPE_PLAN]: definition({ queue: 'music', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.SOUNDSCAPE_GENERATE]: definition({ queue: 'music', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.FINAL_VIDEO_RENDER]: definition({ queue: 'video', maxAttempts: 1, executionProtocol: 'handler_result_checkpoint', ...target('final_video_render') }),
  [TASK_TYPE.CHAPTER_RENDER]: definition({ queue: 'video', maxAttempts: 1, executionProtocol: 'handler_result_checkpoint', ...target('chapter_render') }),
  [TASK_TYPE.VIDEO_PANEL]: definition({ queue: 'video', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.VIDEO_GROUP]: definition({ queue: 'video', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...target('video_group') }),
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: definition({ queue: 'image', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.REGENERATE_GROUP]: definition({ queue: 'image', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.ASSET_HUB_IMAGE]: definition({ queue: 'image', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.ASSET_HUB_MODIFY]: definition({ queue: 'image', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...target('edit_bible') }),
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...target('edit_bible') }),
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.AI_MODIFY_LOCATION]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.AI_MODIFY_PROP]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.AI_CREATE_CHARACTER]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.AI_CREATE_LOCATION]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: definition({ queue: 'text', maxAttempts: 3, executionProtocol: 'handler_result_checkpoint', ...NONE }),
} satisfies Record<TaskType, TaskDefinition>

export function getTaskDefinition(type: TaskType): TaskDefinition {
  return TASK_DEFINITIONS[type]
}
