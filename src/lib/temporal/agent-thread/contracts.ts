import type {
  AgentTurnAdmissionReceipt,
  AgentTurnCommandEnvelope,
  AgentTurnExecutionResult,
  AgentTurnRecord,
} from '@/lib/agent-turn/contracts'
import type {
  AgentTurnApprovalDecisionReceipt,
  ResolveAgentTurnApprovalCommand,
} from '@/lib/agent-turn/approval'
import type {
  ResolveAgentTurnChoiceCommand,
  ResolvedAgentTurnChoice,
} from '@/lib/agent-turn/choice'
import type {
  AgentThreadClearReceipt,
  AgentTurnCancellationReceipt,
  CancelAgentTurnCommand,
  ClearAgentThreadCommand,
} from '@/lib/agent-turn/lifecycle'

export const AGENT_THREAD_UPDATE_NAME = {
  SUBMIT_TURN: 'agent-thread.submit-turn',
  RESOLVE_APPROVAL: 'agent-thread.resolve-approval',
  RESOLVE_CHOICE: 'agent-thread.resolve-choice',
  CANCEL_TURN: 'agent-thread.cancel-turn',
  CLEAR_THREAD: 'agent-thread.clear',
} as const

export interface AgentThreadCoordinatorWorkflowInput {
  workflowId: string
  threadId: string
}

export interface AdmitAgentTurnActivityInput {
  workflowId: string
  envelope: AgentTurnCommandEnvelope
}

export interface RecoverAgentThreadActivityInput {
  workflowId: string
  threadId: string
}

export interface AgentThreadRecoveryReceipt {
  threadExists: boolean
  queued: readonly AgentThreadQueuedTurn[]
  recoveredTurns: readonly AgentTurnRecord[]
  waitingApproval: AgentTurnExecutionResult | null
  resolvedApproval: AgentTurnApprovalDecisionReceipt | null
  pendingChoiceTurnId: string | null
}

export interface ExecuteAgentTurnActivityInput {
  workflowId: string
  threadId: string
  turnId: string
  executionOwnerId: string
}

export interface SettleLostAgentTurnActivityInput {
  workflowId: string
  threadId: string
  turnId: string
  executionOwnerId: string
  errorCode: string
  errorMessage: string
}

export interface ResolveAgentTurnApprovalActivityInput {
  workflowId: string
  command: ResolveAgentTurnApprovalCommand
}

export interface ResolveAgentTurnChoiceActivityInput {
  workflowId: string
  command: ResolveAgentTurnChoiceCommand
}

export interface CancelAgentTurnActivityInput {
  workflowId: string
  command: CancelAgentTurnCommand
}

export interface ClearAgentThreadActivityInput {
  workflowId: string
  command: ClearAgentThreadCommand
}

export interface AgentTurnChoiceResolutionReceipt {
  resolution: ResolvedAgentTurnChoice
  envelope: AgentTurnCommandEnvelope
}

export interface ResumeAgentTurnApprovalActivityInput {
  workflowId: string
  threadId: string
  turnId: string
  interactionId: string
  executionOwnerId: string
}

export interface AgentThreadCoordinatorActivities {
  recoverAgentThread(input: RecoverAgentThreadActivityInput): Promise<AgentThreadRecoveryReceipt>
  admitAgentTurn(input: AdmitAgentTurnActivityInput): Promise<AgentTurnAdmissionReceipt>
  executeAgentTurn(input: ExecuteAgentTurnActivityInput): Promise<AgentTurnExecutionResult>
  settleLostAgentTurn(input: SettleLostAgentTurnActivityInput): Promise<AgentTurnExecutionResult>
  resolveAgentTurnApproval(
    input: ResolveAgentTurnApprovalActivityInput,
  ): Promise<AgentTurnApprovalDecisionReceipt>
  resolveAgentTurnChoice(
    input: ResolveAgentTurnChoiceActivityInput,
  ): Promise<AgentTurnChoiceResolutionReceipt>
  cancelAgentTurn(input: CancelAgentTurnActivityInput): Promise<AgentTurnCancellationReceipt>
  clearAgentThread(input: ClearAgentThreadActivityInput): Promise<AgentThreadClearReceipt>
  resumeAgentTurnApproval(
    input: ResumeAgentTurnApprovalActivityInput,
  ): Promise<AgentTurnExecutionResult>
}

export interface AgentThreadQueuedTurn {
  commandId: string
  payloadHash: string
  turn: AgentTurnRecord
}

export interface AgentThreadCoordinatorResult {
  workflowId: string
  threadId: string
  lastTurn: AgentTurnExecutionResult | null
}
