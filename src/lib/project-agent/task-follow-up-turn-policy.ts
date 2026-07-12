import type { OperationIntent } from '@/lib/operations/types'
import type {
  ProjectAgentWaitTerminalStatus,
} from './waits'

export interface ProjectAgentTaskFollowUpTurnPolicy {
  readonly allowOperationIntent: (intent: OperationIntent) => boolean
  readonly workflowNextActionIsObligation: boolean
  readonly explanationSettlement: 'completed' | 'failed'
}

/**
 * A failed Task handoff opens an explanation turn, not a recovery execution
 * turn. Workflow recovery actions remain available to a later user turn, but
 * failure alone cannot authorize another domain write or billable Approval.
 */
export function resolveProjectAgentTaskFollowUpTurnPolicy(
  terminalStatus: ProjectAgentWaitTerminalStatus,
): ProjectAgentTaskFollowUpTurnPolicy {
  if (terminalStatus === 'failed') {
    return {
      allowOperationIntent: (intent) => intent !== 'act',
      workflowNextActionIsObligation: false,
      explanationSettlement: 'failed',
    }
  }
  return {
    allowOperationIntent: () => true,
    workflowNextActionIsObligation: true,
    explanationSettlement: terminalStatus === 'completed' ? 'completed' : 'failed',
  }
}
