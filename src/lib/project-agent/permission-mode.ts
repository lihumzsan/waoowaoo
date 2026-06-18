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

const AUTO_APPROVED_EDIT_FIRST_OPERATION_IDS: ReadonlySet<string> = new Set([
  'generate_edit_screenplay',
  'revise_edit_screenplay',
  'generate_edit_style_previews',
  'generate_edit_director_decoupage',
  'generate_edit_script',
  'generate_edit_script_assets',
  'generate_edit_cinematography_shot_plan',
  'generate_edit_script_storyboard_spatial_blocking',
  'generate_edit_script_storyboard',
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
  if (AUTO_APPROVED_EDIT_FIRST_OPERATION_IDS.has(params.operation.id)) return false
  if (params.mode === 'auto') return false
  return params.operation.confirmation.required === true
}
