import type { ProjectAgentOperationDefinition } from '@/lib/operations/types'

export type AssistantPermissionMode = 'ask' | 'auto'

const ASSISTANT_PERMISSION_MODES: readonly AssistantPermissionMode[] = ['ask', 'auto'] as const

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

export function shouldRequireAssistantToolApproval(params: {
  mode: AssistantPermissionMode
  operation: ProjectAgentOperationDefinition
}): boolean {
  if (params.operation.agentFlow?.suspendsFor === 'choice') return false
  if (params.operation.confirmation.kind === 'billable_media') return true
  if (params.mode === 'auto') return false
  return params.operation.confirmation.kind === 'destructive'
}
