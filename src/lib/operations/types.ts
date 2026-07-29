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
  /** Host-owned Activity identity for nested execution projection only. */
  activityId?: string | null
  executionAuthorization?: OperationExecutionAuthorization | null
  executionFence?: ProjectAgentOperationExecutionFence | null
  taskBatchBinding?: ProjectAgentOperationTaskBatchBinding | null
  /**
   * Ephemeral server-only state produced while binding the model-visible
   * input contract for this exact execution. It is never serialized into the
   * tool schema or approval payload.
   */
  boundToolContractState?: unknown
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

export type OperationToolExposure = 'direct' | 'on_demand'

export const OPERATION_MODEL_RESULT_RETENTIONS = ['recoverable', 'irreplaceable'] as const
export type OperationModelResultRetention = (typeof OPERATION_MODEL_RESULT_RETENTIONS)[number]

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

/**
 * Opt-in capability for a deterministic, transaction-only domain mutation
 * that may be frozen into a durable Choice Offer and committed with the
 * user's current answer. Choice never owns domain semantics; the target
 * Operation remains the sole writer and revalidates its complete input.
 */
export interface OperationChoiceCommit {
  enabled: true
}

export type RuntimeSchemaSafeParseResult<T> = { success: true; data: T } | { success: false; error: { issues: unknown } }

export type RuntimeSchema<T> = FlexibleSchema<T> & {
  safeParse: (input: unknown) => RuntimeSchemaSafeParseResult<T>
}

export interface ProjectAgentToolInputBindingContext {
  readonly userId: string
  readonly projectId: string
  readonly context: ProjectAgentContext
}

export interface ProjectAgentToolInputBinding<Input> {
  readonly inputSchema: RuntimeSchema<Input>
  /**
   * Server-only facts resolved together with the public schema. The Operation
   * may consume these facts so configuration cannot race between contract
   * verification and planning.
   */
  readonly state?: unknown
}

type BivariantToolInputSchemaBinder<Input> = {
  bivarianceHack(
    context: ProjectAgentToolInputBindingContext,
  ): Promise<ProjectAgentToolInputBinding<Input>>
}['bivarianceHack']

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
  | 'OPERATION_CONTRACT_STALE'
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
  /**
   * Stable model transport for this Operation. Direct Operations are always
   * present as full SDK tools; on-demand Operations are loaded through the
   * fixed discovery/execution gateway.
   */
  toolExposure?: OperationToolExposure
  /**
   * Whether this Operation's result can be recovered once it has scrolled out
   * of the model's context.
   *
   * `recoverable` is the ordinary case: reads can be re-issued, and writes
   * leave a receipt whose outcome survives in the cleared placeholder, so the
   * body may be shed under budget pressure. `irreplaceable` marks a result
   * that exists nowhere else — a user's answer to a Choice is the case that
   * matters, since it arrives as a synthetic tool result and cannot be
   * re-fetched from anything. Shedding one of those would silently lose a
   * decision the user already made.
   */
  modelResultRetention?: OperationModelResultRetention
  prerequisites?: Partial<OperationPrerequisites>
  effects: OperationEffects
  resourceContract?: CreativeResourceOperationContract
  agentFlow?: OperationAgentFlow
  choiceCommit?: OperationChoiceCommit
  /**
   * Model-facing Operation input schema returned by the fixed Agent gateway.
   * This schema must never expose internal execution fields such as
   * `confirmed`. The gateway transports it as data and the canonical runtime
   * schema still validates every invocation.
   */
  toolInputSchema?: ProjectAgentToolInputSchema
  /**
   * Bind current public product capabilities into one execution-segment
   * contract. Only on-demand tools may declare a binder. The returned runtime
   * schema remains the sole source from which its strict JSON Schema is
   * generated; binders must not author a second JSON Schema.
   */
  bindToolInputSchema?: BivariantToolInputSchemaBinder<Input>
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
  /**
   * Revision of the server-owned plan/commit contract consumed across the
   * approval boundary. Change it whenever the same normalized input may be
   * interpreted into a different immutable plan or commit meaning.
   */
  planContractRevision: string
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
  toolExposure: OperationToolExposure
  modelResultRetention: OperationModelResultRetention
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

export type BillableProjectAgentOperationDefinition<Input = unknown, Output = unknown> =
  ProjectAgentOperationDefinitionFields<Input, Output> &
  NormalizedOperationFields &
  NormalizedBillableOperationBehavior<Input, Output>

export type ProjectAgentOperationDefinition<Input = unknown, Output = unknown> =
  | (ProjectAgentOperationDefinitionFields<Input, Output> &
    NormalizedOperationFields &
    NormalizedDirectOperationBehavior<Input, Output>)
  | BillableProjectAgentOperationDefinition<Input, Output>

export function isBillablePlannedOperation<Input, Output>(
  operation: ProjectAgentOperationDefinition<Input, Output>,
): operation is BillableProjectAgentOperationDefinition<Input, Output> {
  return operation.confirmation.kind === 'billable_media'
}

export type ProjectAgentOperationRegistryDraft = Record<ProjectAgentOperationId, ProjectAgentOperationDefinitionBase>

export type ProjectAgentOperationRegistry = Record<ProjectAgentOperationId, ProjectAgentOperationDefinition>

export function writeOperationDataPart<T>(
  writer: UIMessageStreamWriter<UIMessage> | null | undefined,
  type: WorkspaceAssistantPartType,
  data: T,
  /**
   * A stable id lets successive writes reconcile into one part instead of
   * appending a new card per update, which is what live progress needs.
   */
  options?: { readonly id?: string },
) {
  if (!writer) return
  writer.write({
    type,
    ...(options?.id ? { id: options.id } : {}),
    data,
  })
}
