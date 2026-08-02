import type {
  PersistedTaskReference,
  ScheduledTaskReceipt,
} from '../task/contracts'

export const OPERATION_EXECUTION_PROTOCOL = 'operation_execution_v1' as const

export const OPERATION_EXECUTION_MAX_CANONICAL_BYTES = 256 * 1_024
export const OPERATION_EXECUTION_MAX_SOURCE_LENGTH = 64
export const OPERATION_EXECUTION_MAX_TASKS = 64

export interface ApprovedPlanOperationExecutionCommand {
  protocol: typeof OPERATION_EXECUTION_PROTOCOL
  kind: 'approved_plan'
  executionId: string
  userId: string
  projectId: string
  operationId: string
  approvalGrantId: string
  operationRequestId: string
  source: string
  context: DirectTaskOperationContextSnapshot
}

export interface DirectTaskOperationContextSnapshot {
  locale: string | null
  selectedScopeRef: string | null
  selectedAssetId: string | null
  origin:
    | {
        kind: 'agent_turn'
        turnId: string
        callId: string
      }
    | {
        kind: 'api'
      }
}

export interface DirectTaskOperationExecutionCommand {
  protocol: typeof OPERATION_EXECUTION_PROTOCOL
  kind: 'direct_task'
  executionId: string
  userId: string
  projectId: string
  operationId: string
  operationRequestId: string
  source: string
  channel: 'tool' | 'api'
  executionContractRevision: string
  context: DirectTaskOperationContextSnapshot
  normalizedInput: unknown
}

export type OperationExecutionCommand =
  ApprovedPlanOperationExecutionCommand | DirectTaskOperationExecutionCommand

export interface OperationExecutionCommandEnvelope {
  commandId: string
  payloadHash: string
  command: OperationExecutionCommand
}

export interface OperationExecutionWorkflowInput {
  workflowId: string
  envelope: OperationExecutionCommandEnvelope
}

export interface ExecuteOperationActivityInput {
  workflowId: string
  envelope: OperationExecutionCommandEnvelope
}

export interface OperationExecutionTaskSchedule {
  reference: PersistedTaskReference
  schedule: ScheduledTaskReceipt
}

export interface OperationExecutionWorkflowReceipt {
  workflowId: string
  commandId: string
  payloadHash: string
  executionId: string
  operationExecutionId: string
  operationRequestId: string
  outputHash: string
  tasks: readonly OperationExecutionTaskSchedule[]
}

export interface OperationExecutionActivities {
  executeOperation(
    input: ExecuteOperationActivityInput,
  ): Promise<OperationExecutionWorkflowReceipt>
}
