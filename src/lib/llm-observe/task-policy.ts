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

export function getLLMTaskPolicy(taskType: string | null | undefined): LLMTaskPolicy {
  void taskType
  return DEFAULT_POLICY
}

export function isLLMTaskType(taskType: string | null | undefined): boolean {
  void taskType
  return false
}
