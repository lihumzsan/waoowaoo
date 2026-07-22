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

const POLICY_BY_TASK_TYPE: Partial<Record<TaskType, LLMTaskPolicy>> = {
  [TASK_TYPE.CREATIVE_WORK]: LONG_FLOW_POLICY,
}

export function getLLMTaskPolicy(taskType: string | null | undefined): LLMTaskPolicy {
  if (!taskType) return DEFAULT_POLICY
  return POLICY_BY_TASK_TYPE[taskType as TaskType] || DEFAULT_POLICY
}

export function isLLMTaskType(taskType: string | null | undefined): taskType is TaskType {
  return typeof taskType === 'string'
    && Object.prototype.hasOwnProperty.call(POLICY_BY_TASK_TYPE, taskType)
}
