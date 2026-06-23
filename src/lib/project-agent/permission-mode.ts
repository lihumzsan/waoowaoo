import type { ProjectAgentOperationDefinition } from '@/lib/operations/types'
import { isEditFirstAutoApprovedOperationId } from '@/lib/project-workflow/edit-first-operation-policy'
import { EDIT_FIRST_CHOICE_OPERATION_IDS } from './edit-first-choice-tools'

export type AssistantPermissionMode = 'ask' | 'auto'

const ASSISTANT_PERMISSION_MODES: readonly AssistantPermissionMode[] = ['ask', 'auto'] as const

const HUMAN_INPUT_OPERATION_IDS: ReadonlySet<string> = new Set([
  'ui_cancel',
  'ui_confirm',
  'ui_single_select',
  'ui_multi_select',
  'ui_safety_ack',
  ...EDIT_FIRST_CHOICE_OPERATION_IDS,
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
  if (isEditFirstAutoApprovedOperationId(params.operation.id)) return false
  if (params.mode === 'auto') return false
  return params.operation.confirmation.required === true
}
