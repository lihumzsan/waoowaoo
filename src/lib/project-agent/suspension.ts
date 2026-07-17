import type { EditFirstChoiceType } from './edit-first-choice-tools'
import type { ProjectAgentChoiceCardPartData } from './types'

/**
 * A suspension is a durable handoff from one Assistant execution segment to
 * an external responder. It is intentionally a protocol kind, never an
 * operation id or a UI rendering hint.
 */
export type ProjectAgentSuspensionKind = 'choice' | 'approval'

interface ProjectAgentSuspensionReceiptBase {
  kind: ProjectAgentSuspensionKind
  runId: string
  operationId: string
  activityId: string
}

export interface ProjectAgentChoiceSuspensionReceipt extends ProjectAgentSuspensionReceiptBase {
  kind: 'choice'
  interruptionId: string
  cardId: string
  toolCallId: string
  choiceType: EditFirstChoiceType
  card: ProjectAgentChoiceCardPartData
}

export interface ProjectAgentApprovalSuspensionReceipt extends ProjectAgentSuspensionReceiptBase {
  kind: 'approval'
  interruptionId: string
  approvalId: string
  toolCallId: string | null
}

export type ProjectAgentSuspensionReceipt =
  | ProjectAgentChoiceSuspensionReceipt
  | ProjectAgentApprovalSuspensionReceipt

export function assertProjectAgentSuspensionReceipt(params: {
  receipt: ProjectAgentSuspensionReceipt
  runId: string
  kind?: ProjectAgentSuspensionKind
  operationId?: string
}): void {
  if (params.receipt.runId !== params.runId) {
    throw new Error(`PROJECT_AGENT_SUSPENSION_RECEIPT_RUN_MISMATCH:${params.receipt.runId}:${params.runId}`)
  }
  if (params.kind && params.receipt.kind !== params.kind) {
    throw new Error(`PROJECT_AGENT_SUSPENSION_RECEIPT_KIND_MISMATCH:${params.receipt.kind}:${params.kind}`)
  }
  if (params.operationId && params.receipt.operationId !== params.operationId) {
    throw new Error(
      `PROJECT_AGENT_SUSPENSION_RECEIPT_OPERATION_MISMATCH:${params.receipt.operationId}:${params.operationId}`,
    )
  }
}

export function isSameProjectAgentSuspensionReceipt(
  left: ProjectAgentSuspensionReceipt,
  right: ProjectAgentSuspensionReceipt,
): boolean {
  if (
    left.kind !== right.kind
    || left.runId !== right.runId
    || left.operationId !== right.operationId
    || left.activityId !== right.activityId
  ) return false
  if (left.kind === 'choice' && right.kind === 'choice') {
    return left.interruptionId === right.interruptionId
      && left.cardId === right.cardId
      && left.toolCallId === right.toolCallId
      && left.choiceType === right.choiceType
  }
  if (left.kind === 'approval' && right.kind === 'approval') {
    return left.interruptionId === right.interruptionId
      && left.approvalId === right.approvalId
      && left.toolCallId === right.toolCallId
  }
  return false
}
