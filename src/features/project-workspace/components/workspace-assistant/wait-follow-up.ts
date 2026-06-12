'use client'

export interface WorkspaceAssistantWaitFollowUpDecisionInput {
  readonly operationId: string
  readonly terminalStatus: 'completed' | 'failed'
}

export function shouldSendAssistantWaitFollowUp(
  followUp: WorkspaceAssistantWaitFollowUpDecisionInput,
): boolean {
  if (followUp.operationId === 'generate_edit_style_previews' && followUp.terminalStatus === 'completed') {
    return false
  }
  return true
}
