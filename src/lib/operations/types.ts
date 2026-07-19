import type { FlexibleSchema, UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import type { ProjectAgentContext, WorkspaceAssistantPartType } from '@/lib/project-agent/types'
import type { OperationPlan } from './planning'
import type { OperationExecutionAuthorization } from './planned-operation-invocation'
import type { Prisma } from '@prisma/client'
import type { ProjectAgentOperationExecutionFence } from '@/lib/project-agent/operation-execution-fence'
import type { ProjectAgentChoiceHandoffReceipt } from '@/lib/project-agent/execution-handoff'
import type { WorkspaceResourceImpact } from '@/lib/workspace-resource/resource-impact'
import type { CreativeResourceOperationContract } from '@/lib/creative-resource/contracts'

export type ProjectAgentOperationId = string

export interface ProjectAgentOperationContext {
  request: NextRequest
  userId: string
  projectId: string
  context: ProjectAgentContext
  /**
   * Operation invocation source (entry semantics).
   * - assistant-panel: initiated by assistant tools in chat
   * - project-ui/api: initiated by explicit GUI/API actions
   */
  source: string
  writer?: UIMessageStreamWriter<UIMessage> | null
  toolCallId?: string | null
  executionAuthorization?: OperationExecutionAuthorization | null
  executionFence?: ProjectAgentOperationExecutionFence | null
  taskBatchBinding?: ProjectAgentOperationTaskBatchBinding | null
}

export interface ProjectAgentOperationTaskBatchBinding {
  bindInTransaction(
    transaction: Prisma.TransactionClient,
    batch: { operationId: string; taskIds: readonly string[] },
  ): Promise<ProjectAgentTaskSubmissionReceipt | null>
  isBound(): boolean
  markCommitted(): void
  isCommitted(): boolean
  getCommittedReceipt(): ProjectAgentTaskSubmissionReceipt | null
}

/**
 * Durable Task submission identity returned to the Agent without suspending
 * the foreground model loop. The background Run/Wait pair owns completion.
 */
export interface ProjectAgentTaskSubmissionReceipt {
  kind: 'task_submission'
  batchId: string
  backgroundRunId: string
  waitId: string
  operationId: string
  taskIds: readonly string[]
}

export type ProjectAgentOperationOutcome =
  | { kind: 'completed'; data: unknown }
  | { kind: 'noop'; data: unknown }
  | { kind: 'submitted_tasks'; data: unknown; receipt: ProjectAgentTaskSubmissionReceipt }
  | { kind: 'wait_choice'; data: unknown; choiceHandoff: ProjectAgentChoiceHandoffReceipt }
  | { kind: 'wait_approval' }
  | { kind: 'failed'; error: ProjectAgentToolError }

type BivariantOperationExecute<Input, Output> = {
  bivarianceHack(context: ProjectAgentOperationContext, input: Input): Promise<Output>
}['bivarianceHack']

type BivariantTransactionalOperationExecute<Input, Output> = {
  bivarianceHack(
    context: ProjectAgentOperationContext,
    input: Input,
    transaction: Prisma.TransactionClient,
    prepared: unknown,
  ): Promise<Output>
}['bivarianceHack']

type BivariantTransactionalOperationPrepare<Input> = {
  bivarianceHack(
    context: ProjectAgentOperationContext,
    input: Input,
  ): Promise<unknown>
}['bivarianceHack']

type BivariantTransactionalOperationCompensate<Input, Output> = {
  bivarianceHack(
    context: ProjectAgentOperationContext,
    input: Input,
    prepared: unknown,
    output: Output | null,
    transactionError: unknown,
  ): Promise<void>
}['bivarianceHack']

type BivariantOperationPlan<Input> = {
  bivarianceHack(context: ProjectAgentOperationContext, input: Input): Promise<OperationPlan>
}['bivarianceHack']

type BivariantOperationCommit<Input, Output> = {
  bivarianceHack(context: ProjectAgentOperationContext, input: Input, plan: OperationPlan): Promise<Output>
}['bivarianceHack']

export type OperationIntent = 'query' | 'plan' | 'act'

export type OperationGroupPath = string[]

export interface OperationPrerequisites {
  episodeId: 'required' | 'optional' | 'forbidden'
}

export interface OperationChannels {
  tool: boolean
  api: boolean
}

type OperationEffectFlags = {
  billable: boolean
  destructive: boolean
  overwrite: boolean
  bulk: boolean
  externalSideEffects: boolean
  longRunning: boolean
}

export type OperationEffects = OperationEffectFlags & (
  | {
      writes: false
      workspaceResourceImpact?: never
    }
  | {
      writes: true
      workspaceResourceImpact: WorkspaceResourceImpact
    }
)

export type AssistantOperationWriteAuthority = {
  kind: 'transactional_task_submission'
}

export type OperationApprovalKind = 'none' | 'billable_media' | 'destructive'

export interface OperationConfirmation {
  kind: OperationApprovalKind
  required: boolean
  summary?: string | null
  budget?: {
    key?: string
    estimatedCostUnits?: number
  } | null
}

/** Operation-declared user-interaction semantics. */
export interface OperationAgentFlow {
  /**
   * A tool-owned, durable suspension protocol. Approval is created by the
   * Agents SDK approval boundary, while Choice is declared by the operation
   * that settles its Offer.
   */
  suspendsFor?: 'choice' | null
}

export type RuntimeSchemaSafeParseResult<T> = { success: true; data: T } | { success: false; error: { issues: unknown } }

export type RuntimeSchema<T> = FlexibleSchema<T> & {
  safeParse: (input: unknown) => RuntimeSchemaSafeParseResult<T>
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export interface ProjectAgentToolInputSchema {
  [key: string]: JsonValue | undefined
  type: 'object'
  properties: Record<string, JsonValue>
  required: string[]
  additionalProperties: false
  description?: string
}

export type ProjectAgentToolErrorCode =
  | 'CONFIRMATION_REQUIRED'
  | 'OPERATION_NOT_ALLOWED'
  | 'OPERATION_EXECUTION_FAILED'
  | 'OPERATION_INPUT_INVALID'
  | 'OPERATION_NOT_FOUND'
  | 'OPERATION_PLAN_CHANGED'
  | 'OPERATION_PREREQUISITE_MISSING'
  | 'OPERATION_OUTPUT_INVALID'

export interface ProjectAgentToolError {
  code: ProjectAgentToolErrorCode
  message: string
  operationId?: ProjectAgentOperationId
  details?: Record<string, unknown> | null
  issues?: unknown
}

export type ProjectAgentToolResult<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      confirmationRequired?: boolean
      error: ProjectAgentToolError
    }

interface ProjectAgentOperationDefinitionFields<Input = unknown, Output = unknown> {
  id: ProjectAgentOperationId
  /**
   * Command-style summary used for tool prompt, logs, and review.
   * Must be a non-empty string after trimming.
   */
  summary: string
  intent: OperationIntent
  groupPath?: OperationGroupPath
  channels?: OperationChannels
  prerequisites?: Partial<OperationPrerequisites>
  effects: OperationEffects
  resourceContract?: CreativeResourceOperationContract
  agentFlow?: OperationAgentFlow
  /**
   * Model-facing OpenAI Agents SDK tool input schema.
   * This schema must never expose internal execution fields such as
   * `confirmed`, and must be strict structured-output compatible.
   */
  toolInputSchema?: ProjectAgentToolInputSchema
  inputSchema: RuntimeSchema<Input>
  outputSchema: RuntimeSchema<Output>
}

type NonTransactionalDirectOperationBehavior<Input, Output> = {
  confirmation?: Omit<OperationConfirmation, 'kind'> & {
    kind?: Exclude<OperationApprovalKind, 'billable_media'>
  }
  plan?: never
  commit?: never
  execute: BivariantOperationExecute<Input, Output>
  executeInTransaction?: never
  prepareTransaction?: never
  compensateTransactionFailure?: never
  assistantWriteAuthority?: Extract<AssistantOperationWriteAuthority, {
    kind: 'transactional_task_submission'
  }>
}

type TransactionalDirectOperationBehaviorBase<Input, Output> = {
  confirmation?: Omit<OperationConfirmation, 'kind'> & {
    kind?: Exclude<OperationApprovalKind, 'billable_media'>
  }
  plan?: never
  commit?: never
  execute?: never
  executeInTransaction: BivariantTransactionalOperationExecute<Input, Output>
  assistantWriteAuthority?: never
}

type TransactionalDirectOperationBehavior<Input, Output> =
  TransactionalDirectOperationBehaviorBase<Input, Output> & (
    | {
        prepareTransaction?: never
        compensateTransactionFailure?: never
      }
    | {
        prepareTransaction: BivariantTransactionalOperationPrepare<Input>
        compensateTransactionFailure: BivariantTransactionalOperationCompensate<Input, Output>
      }
  )

type DirectOperationBehavior<Input, Output> =
  | NonTransactionalDirectOperationBehavior<Input, Output>
  | TransactionalDirectOperationBehavior<Input, Output>

type BillablePlannedOperationBehavior<Input, Output> = {
  confirmation: Omit<OperationConfirmation, 'kind'> & {
    kind: 'billable_media'
    required: true
  }
  plan: BivariantOperationPlan<Input>
  commit: BivariantOperationCommit<Input, Output>
  execute?: never
  executeInTransaction?: never
  prepareTransaction?: never
  compensateTransactionFailure?: never
  assistantWriteAuthority?: never
}

export type ProjectAgentOperationDefinitionBase<Input = unknown, Output = unknown> = ProjectAgentOperationDefinitionFields<Input, Output> &
  (DirectOperationBehavior<Input, Output> | BillablePlannedOperationBehavior<Input, Output>)

type NormalizedOperationFields = {
  groupPath: OperationGroupPath
  channels: OperationChannels
  prerequisites: OperationPrerequisites
  toolInputSchema: ProjectAgentToolInputSchema
  resourceContract: CreativeResourceOperationContract
}

type NormalizedDirectOperationBehavior<Input, Output> = DirectOperationBehavior<Input, Output> & {
  confirmation: OperationConfirmation & { kind: 'none' | 'destructive' }
}

type NormalizedBillableOperationBehavior<Input, Output> = BillablePlannedOperationBehavior<Input, Output> & {
  confirmation: OperationConfirmation & {
    kind: 'billable_media'
    required: true
  }
}

export type ProjectAgentOperationDefinition<Input = unknown, Output = unknown> = ProjectAgentOperationDefinitionFields<Input, Output> &
  NormalizedOperationFields &
  (NormalizedDirectOperationBehavior<Input, Output> | NormalizedBillableOperationBehavior<Input, Output>)

export type ProjectAgentOperationRegistryDraft = Record<ProjectAgentOperationId, ProjectAgentOperationDefinitionBase>

export type ProjectAgentOperationRegistry = Record<ProjectAgentOperationId, ProjectAgentOperationDefinition>

export function writeOperationDataPart<T>(
  writer: UIMessageStreamWriter<UIMessage> | null | undefined,
  type: WorkspaceAssistantPartType,
  data: T,
) {
  if (!writer) return
  writer.write({
    type,
    data,
  })
}
