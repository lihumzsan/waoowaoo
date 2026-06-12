import type { ProjectAgentOperationDefinition } from '@/lib/operations/types'

export type AssistantPermissionMode = 'ask' | 'auto'

const ASSISTANT_PERMISSION_MODES: readonly AssistantPermissionMode[] = ['ask', 'auto'] as const

const HUMAN_INPUT_OPERATION_IDS: ReadonlySet<string> = new Set([
  'ui_cancel',
  'ui_confirm',
  'ui_single_select',
  'ui_multi_select',
  'ui_safety_ack',
  'request_edit_first_choice',
])

export function isAssistantPermissionMode(value: unknown): value is AssistantPermissionMode {
  return typeof value === 'string' && ASSISTANT_PERMISSION_MODES.includes(value as AssistantPermissionMode)
}

export function parseAssistantPermissionMode(value: unknown): AssistantPermissionMode {
  if (value === undefined || value === null || value === '') {
    throw new Error('PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_REQUIRED')
  }
  if (!isAssistantPermissionMode(value)) {
    throw new Error('PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_INVALID')
  }
  return value
}

export function isHumanInputOperation(operationId: string): boolean {
  return HUMAN_INPUT_OPERATION_IDS.has(operationId)
}

export function shouldRequireAssistantToolApproval(params: {
  mode: AssistantPermissionMode
  operation: ProjectAgentOperationDefinition
}): boolean {
  if (isHumanInputOperation(params.operation.id)) return false
  return params.mode === 'ask'
}
