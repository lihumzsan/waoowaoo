import type { UIMessage } from 'ai'
import type { AgentInputItem } from '@openai/agents'

export const AGENT_TURN_PROTOCOL = 'agent_turn_v1' as const

export const AGENT_TURN_SOURCE_KIND = {
  USER: 'user',
  TASK_FOLLOW_UP: 'task_follow_up',
  CHOICE_RESPONSE: 'choice_response',
} as const

export type AgentTurnSourceKind =
  (typeof AGENT_TURN_SOURCE_KIND)[keyof typeof AGENT_TURN_SOURCE_KIND]

export const AGENT_TURN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING_APPROVAL: 'waiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
  CANCELLED: 'cancelled',
} as const

export type AgentTurnStatus = (typeof AGENT_TURN_STATUS)[keyof typeof AGENT_TURN_STATUS]

export const AGENT_TURN_ACTIVE_STATUSES = [
  AGENT_TURN_STATUS.QUEUED,
  AGENT_TURN_STATUS.RUNNING,
  AGENT_TURN_STATUS.WAITING_APPROVAL,
] as const satisfies readonly AgentTurnStatus[]

export function isAgentTurnStatus(value: unknown): value is AgentTurnStatus {
  return (
    typeof value === 'string' &&
    (Object.values(AGENT_TURN_STATUS) as readonly string[]).includes(value)
  )
}

export const AGENT_TURN_INTERACTION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
} as const

export type AgentTurnInteractionStatus =
  (typeof AGENT_TURN_INTERACTION_STATUS)[keyof typeof AGENT_TURN_INTERACTION_STATUS]

export interface AgentTurnContextSnapshot {
  locale: string | null
  episodeId: string | null
  selectedScopeRef: string | null
  selectedAssetId: string | null
}

export interface SubmitAgentTurnCommand {
  protocol: typeof AGENT_TURN_PROTOCOL
  threadId: string
  projectId: string
  userId: string
  assistantId: 'workspace-command'
  sourceKind: AgentTurnSourceKind
  sourceId: string
  requestId: string
  userMessage: UIMessage | null
  context: AgentTurnContextSnapshot
}

export interface AgentTurnCommandEnvelope {
  commandId: string
  payloadHash: string
  command: SubmitAgentTurnCommand
}

export interface AgentTurnRecord {
  id: string
  threadId: string
  projectId: string
  userId: string
  episodeId: string | null
  sourceKind: AgentTurnSourceKind
  sourceId: string
  payloadHash: string
  requestId: string
  status: AgentTurnStatus
  attempt: number
  modelHistoryBaseVersion: number | null
  stopReason: string | null
  errorCode: string | null
  errorMessage: string | null
}

interface AgentTurnAdmissionReceiptBase {
  workflowId: string
  commandId: string
  payloadHash: string
  threadId: string
}

export type AgentTurnAdmissionReceipt =
  | (AgentTurnAdmissionReceiptBase & {
      outcome: 'accepted'
      turn: AgentTurnRecord
      ignoredReason: null
    })
  | (AgentTurnAdmissionReceiptBase & {
      outcome: 'ignored'
      turn: null
      ignoredReason: 'source_cancelled'
    })

export interface AgentTurnExecutionResult {
  turnId: string
  status: Extract<
    AgentTurnStatus,
    'waiting_approval' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
  >
  stopReason: string | null
  errorCode: string | null
}

export interface AgentTurnExecutionInput {
  turn: AgentTurnRecord
  context: AgentTurnContextSnapshot
  userMessage: UIMessage | null
  modelHistory: {
    version: number
    items: AgentInputItem[]
  }
}

export interface AgentThreadRecoveryState {
  threadExists: boolean
  queuedTurns: readonly AgentTurnRecord[]
  recoveredTurns: readonly AgentTurnRecord[]
  waitingApproval: AgentTurnExecutionResult | null
  resolvedApproval: {
    threadId: string
    turnId: string
    interactionId: string
    projectId: string
    userId: string
    episodeId: string | null
    requestId: string
    decision: 'approve' | 'reject'
    reason: string | null
  } | null
  pendingChoiceTurnId: string | null
}
