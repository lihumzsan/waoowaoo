import type { FlexibleSchema, UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import type {
  ProjectAgentContext,
  WorkspaceAssistantPartType,
} from '@/lib/project-agent/types'
import type { OperationPlan } from './planning'
import type { OperationExecutionAuthorization } from './planned-operation-invocation'
import type { Prisma } from '@prisma/client'
import type { WorkspaceResourceImpact } from '@/lib/workspace-resource/resource-impact'
import type { WorkspaceResourceOperationContract } from '@/lib/workspace-resource/contracts'
import type { WorkspaceResourceRef } from '@/lib/task/types'

export type ProjectAgentOperationId = string

/**
 * The authoritative invalidation result of one synchronous Operation
 * mutation. The refs are projected from the production Operation registry;
 * callers must never derive them from an Operation's output and may publish
 * them only after the transaction owner has committed.
 */
export interface OperationMutationReceipt {
  protocol: 'operation_mutation_receipt_v1'
  operationId: ProjectAgentOperationId
  changedRefs: readonly WorkspaceResourceRef[]
}

export interface ProjectAgentOperationContext {
  /**
   * HTTP request only exists for an HTTP-owned invocation. Durable Activities
   * receive explicit requestId/cancellation facts and must not fabricate one.
   */
  request: NextRequest | null
  requestId?: string | null
  signal?: AbortSignal
  userId: string
  projectId: string
  context: ProjectAgentContext
  /**
   * Runtime-owned invocation channel. The sole invocation entry overwrites
   * this before executing an Operation; absent values must fail closed as Tool.
   */
  invocationChannel?: 'api' | 'tool'
  /**
   * Operation invocation source (entry semantics).
   * - assistant-panel: initiated by assistant tools in chat
   * - project-ui/api: initiated by explicit GUI/API actions
   */
  source: string
  writer?: UIMessageStreamWriter<UIMessage> | null
  /**
   * Live progress for a long-running Operation, surfaced to the user while the
   * call is still in flight. It is presentation only and best-effort: an
   * Operation's result must never depend on a message being delivered, and a
   * consumer must never derive completion, failure or any business fact from
   * one. Absent when the invocation channel has nowhere to put it.
   */
  reportProgress?: ((message: string) => void) | null
  toolCallId?: string | null
  /** Host-owned Activity identity for nested execution projection only. */
  activityId?: string | null
  /** Durable Operation owner for Task foreign keys and exact replay. */
  operationExecutionId?: string | null
  /** Outer Operation transaction that atomically owns Task creation/output. */
  operationExecutionTransaction?: Prisma.TransactionClient | null
  executionAuthorization?: OperationExecutionAuthorization | null
  followUpBatchBinding?: ProjectAgentFollowUpBatchBinding | null
}

export function requireProjectAgentOperationRequest(
  context: ProjectAgentOperationContext,
): NextRequest {
  if (!context.request) {
    throw new Error('PROJECT_AGENT_OPERATION_HTTP_REQUEST_REQUIRED')
  }
  return context.request
}

export function requireProjectAgentOperationSignal(
  context: ProjectAgentOperationContext,
): AbortSignal {
  const signal = context.signal ?? context.request?.signal
  if (!signal) {
    throw new Error('PROJECT_AGENT_OPERATION_SIGNAL_REQUIRED')
  }
  return signal
}

export interface ProjectAgentFollowUpBatchBinding {
  bindInTransaction(
    transaction: Prisma.TransactionClient,
    batch: { operationId: string; taskIds: readonly string[] },
  ): Promise<void>
  isBound(): boolean
}

type BivariantOperationExecute<Input, Output> = {
  bivarianceHack(
    context: ProjectAgentOperationContext,
    input: Input,
  ): Promise<Output>
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
  bivarianceHack(
    context: ProjectAgentOperationContext,
    input: Input,
  ): Promise<OperationPlan>
}['bivarianceHack']

type BivariantOperationCommit<Input, Output> = {
  bivarianceHack(
    context: ProjectAgentOperationContext,
    input: Input,
    plan: OperationPlan,
  ): Promise<Output>
}['bivarianceHack']

export type OperationIntent = 'query' | 'plan' | 'act'

export type OperationGroupPath = string[]

export interface OperationChannels {
  tool: boolean
  api: boolean
  /** Advertise this existing Tool capability through the Wao MCP transport. */
  mcp: boolean
}

export type OperationChannelsDraft = Omit<OperationChannels, 'mcp'> & {
  mcp?: boolean
}

export type OperationToolExposure = 'direct' | 'on_demand'

export const OPERATION_MODEL_RESULT_RETENTIONS = [
  'recoverable',
  'irreplaceable',
] as const
export type OperationModelResultRetention =
  (typeof OPERATION_MODEL_RESULT_RETENTIONS)[number]

type OperationEffectFlags = {
  billable: boolean
  destructive: boolean
  overwrite: boolean
  bulk: boolean
  externalSideEffects: boolean
  longRunning: boolean
}

export type OperationEffects = OperationEffectFlags &
  (
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
  kind: 'temporal_operation_execution'
  contractRevision: string
  followUpPolicy: 'after_all_terminal' | 'none'
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

export type RuntimeSchemaSafeParseResult<T> =
  { success: true; data: T } | { success: false; error: { issues: unknown } }

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

interface ProjectAgentOperationDefinitionFields<
  Input = unknown,
  Output = unknown,
> {
  id: ProjectAgentOperationId
  /**
   * Immutable meaning of one model-visible synchronous write Operation.
   * Planned and Temporal-owned writes derive the same fact from their
   * existing plan/dispatch contract revision.
   *
   * Bump this value whenever the same accepted Tool input could produce a
   * different business mutation. Approval checkpoints and ToolEffect replay
   * both fence on this revision.
   */
  toolContractRevision?: string
  /**
   * Command-style summary used for tool prompt, logs, and review.
   * Must be a non-empty string after trimming.
   */
  summary: string
  intent: OperationIntent
  groupPath?: OperationGroupPath
  channels?: OperationChannelsDraft
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
  effects: OperationEffects
  resourceContract?: WorkspaceResourceOperationContract
  /**
   * Model-facing Operation input schema returned by the fixed Agent gateway.
   * This schema must never expose internal execution fields such as
   * `confirmed`. The gateway transports it as data and the canonical runtime
   * schema still validates every invocation.
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
  assistantWriteAuthority?: Extract<
    AssistantOperationWriteAuthority,
    {
      kind: 'temporal_operation_execution'
    }
  >
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
  TransactionalDirectOperationBehaviorBase<Input, Output> &
    (
      | {
          prepareTransaction?: never
          compensateTransactionFailure?: never
        }
      | {
          prepareTransaction: BivariantTransactionalOperationPrepare<Input>
          compensateTransactionFailure: BivariantTransactionalOperationCompensate<
            Input,
            Output
          >
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

export type ProjectAgentOperationDefinitionBase<
  Input = unknown,
  Output = unknown,
> = ProjectAgentOperationDefinitionFields<Input, Output> &
  (
    | DirectOperationBehavior<Input, Output>
    | BillablePlannedOperationBehavior<Input, Output>
  )

type NormalizedOperationFields = {
  groupPath: OperationGroupPath
  channels: OperationChannels
  toolExposure: OperationToolExposure
  modelResultRetention: OperationModelResultRetention
  toolInputSchema: ProjectAgentToolInputSchema
  resourceContract: WorkspaceResourceOperationContract
  toolContractRevision: string | null
}

type NormalizedDirectOperationBehavior<Input, Output> = DirectOperationBehavior<
  Input,
  Output
> & {
  confirmation: OperationConfirmation & { kind: 'none' | 'destructive' }
}

type NormalizedBillableOperationBehavior<Input, Output> =
  BillablePlannedOperationBehavior<Input, Output> & {
    confirmation: OperationConfirmation & {
      kind: 'billable_media'
      required: true
    }
  }

export type BillableProjectAgentOperationDefinition<
  Input = unknown,
  Output = unknown,
> = ProjectAgentOperationDefinitionFields<Input, Output> &
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

export type ProjectAgentOperationRegistryDraft = Record<
  ProjectAgentOperationId,
  ProjectAgentOperationDefinitionBase
>

export type ProjectAgentOperationRegistry = Record<
  ProjectAgentOperationId,
  ProjectAgentOperationDefinition
>

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
