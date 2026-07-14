import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import type { LLMObserveDisplayMode } from './config'

export type LLMTaskPolicy = {
  consoleEnabled: boolean
  displayMode: LLMObserveDisplayMode
  fullscreen: boolean
  priority: number
  captureReasoning: boolean
}

const DEFAULT_POLICY: LLMTaskPolicy = {
  consoleEnabled: false,
  displayMode: 'loading',
  fullscreen: false,
  priority: 0,
  captureReasoning: false,
}

const LONG_FLOW_POLICY: LLMTaskPolicy = {
  consoleEnabled: true,
  displayMode: 'detail',
  fullscreen: true,
  priority: 1,
  captureReasoning: true,
}

const LONG_FLOW_HIGH_POLICY: LLMTaskPolicy = {
  ...LONG_FLOW_POLICY,
  priority: 2,
}

const LLM_STANDARD_POLICY: LLMTaskPolicy = {
  consoleEnabled: true,
  displayMode: 'loading',
  fullscreen: false,
  priority: 0,
  captureReasoning: true,
}

const POLICY_BY_TASK_TYPE: Partial<Record<TaskType, LLMTaskPolicy>> = {
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: LONG_FLOW_HIGH_POLICY,
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: LONG_FLOW_HIGH_POLICY,
  [TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE]: LONG_FLOW_HIGH_POLICY,
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: LONG_FLOW_HIGH_POLICY,
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: LONG_FLOW_HIGH_POLICY,
  [TASK_TYPE.AUDIO_DESIGN_PLAN]: LONG_FLOW_POLICY,
  [TASK_TYPE.MUSIC_SCORE_GENERATE]: LONG_FLOW_POLICY,
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: LLM_STANDARD_POLICY,
  [TASK_TYPE.AI_MODIFY_LOCATION]: LLM_STANDARD_POLICY,
  [TASK_TYPE.AI_MODIFY_PROP]: LLM_STANDARD_POLICY,
  [TASK_TYPE.AI_CREATE_CHARACTER]: LLM_STANDARD_POLICY,
  [TASK_TYPE.AI_CREATE_LOCATION]: LLM_STANDARD_POLICY,
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: LLM_STANDARD_POLICY,
  [TASK_TYPE.REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: LLM_STANDARD_POLICY,
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: LLM_STANDARD_POLICY,
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: LLM_STANDARD_POLICY,
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: LLM_STANDARD_POLICY,
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: LLM_STANDARD_POLICY,
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: LLM_STANDARD_POLICY,
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: LLM_STANDARD_POLICY,
  [TASK_TYPE.ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT]: LLM_STANDARD_POLICY,
}

export function getLLMTaskPolicy(taskType: string | null | undefined): LLMTaskPolicy {
  if (!taskType) return DEFAULT_POLICY
  return POLICY_BY_TASK_TYPE[taskType as TaskType] || DEFAULT_POLICY
}

export function isLLMTaskType(taskType: string | null | undefined): taskType is TaskType {
  return typeof taskType === 'string'
    && Object.prototype.hasOwnProperty.call(POLICY_BY_TASK_TYPE, taskType)
}
