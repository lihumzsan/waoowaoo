import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { FlexibleSchema } from '@ai-sdk/provider-utils'
import type { NextRequest } from 'next/server'
import type { ProjectAgentContext, WorkspaceAssistantPartType } from '@/lib/project-agent/types'
import type { OperationPlan } from './planning'
import type { OperationExecutionAuthorization } from './planned-operation-invocation'
import type { Prisma } from '@prisma/client'
import type { ProjectAgentOperationExecutionFence } from '@/lib/project-agent/operation-execution-fence'
import type { ProjectAgentTaskSuspensionReceipt } from '@/lib/project-agent/suspension'
import type { ProjectAgentChoiceHandoffReceipt } from '@/lib/project-agent/execution-handoff'

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
  ): Promise<ProjectAgentTaskSuspensionReceipt | null>
  isBound(): boolean
  markCommitted(): void
  isCommitted(): boolean
  getCommittedSuspension(): ProjectAgentTaskSuspensionReceipt | null
}

export type ProjectAgentOperationOutcome =
  | { kind: 'completed'; data: unknown }
  | { kind: 'noop'; data: unknown }
  | { kind: 'submitted_tasks'; data: unknown; suspension: ProjectAgentTaskSuspensionReceipt }
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
  ): Promise<Output>
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

export interface OperationEffects {
  writes: boolean
  billable: boolean
  destructive: boolean
  overwrite: boolean
  bulk: boolean
  externalSideEffects: boolean
  longRunning: boolean
}

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

/**
 * Agent continuation semantics for this operation, declared next to the
 * operation itself so runtime never special-cases operation ids.
 * onTaskComplete controls what happens when all async tasks submitted by this
 * operation complete successfully:
 * - resume_agent (default): wake the agent with a follow-up turn.
 * Failed tasks always resume the agent so it can report and recover.
 */
export interface OperationAgentFlow {
  onTaskComplete?: 'resume_agent' | 'complete'
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
  assistantWriteAuthority?: Extract<AssistantOperationWriteAuthority, {
    kind: 'transactional_task_submission'
  }>
}

type TransactionalDirectOperationBehavior<Input, Output> = {
  confirmation?: Omit<OperationConfirmation, 'kind'> & {
    kind?: Exclude<OperationApprovalKind, 'billable_media'>
  }
  plan?: never
  commit?: never
  execute?: never
  executeInTransaction: BivariantTransactionalOperationExecute<Input, Output>
  assistantWriteAuthority?: never
}

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
  assistantWriteAuthority?: never
}

export type ProjectAgentOperationDefinitionBase<Input = unknown, Output = unknown> = ProjectAgentOperationDefinitionFields<Input, Output> &
  (DirectOperationBehavior<Input, Output> | BillablePlannedOperationBehavior<Input, Output>)

type NormalizedOperationFields = {
  groupPath: OperationGroupPath
  channels: OperationChannels
  prerequisites: OperationPrerequisites
  toolInputSchema: ProjectAgentToolInputSchema
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
