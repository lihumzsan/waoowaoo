import { randomUUID } from 'node:crypto'
import { ApiError } from '@/lib/api-errors'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  assertProjectAgentOperationExecutionFenceCurrent,
  assertProjectAgentOperationExecutionFenceInTransaction,
  requireProjectAgentChoiceHandoffReceipt,
  runWithProjectAgentOperationExecutionFence,
} from '@/lib/project-agent/operation-execution-fence'
import { dispatchCommittedOutboxCommands } from '@/lib/outbox/dispatcher'
import { createOutboxCommitCollector } from '@/lib/outbox/repository'
import { createWorkspaceResourceBroadcastsInTransaction } from '@/lib/workspace-resource/resource-change-events'
import { resolveWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import { resolveOperationEffectiveEpisodeId, resolveOperationScopeInput } from './environment-input'
import {
  buildProjectAgentToolInputCorrections,
  normalizeProjectAgentToolInput,
} from './tool-input-schema'
import {
  invokeApprovedOperationPlan,
  splitPlannedOperationInvocation,
  type PlannedOperationInvocation,
} from './planned-operation-invocation'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationOutcome,
  ProjectAgentOperationRegistry,
} from './types'
import { assertAssistantToolWriteAuthority } from './write-authority'
import {
  assertOperationChannelAllowed,
  type OperationInvocationChannel,
} from './channel-policy'

export type { OperationInvocationChannel } from './channel-policy'

export type ProjectAgentOperationInvocationResult =
  | {
      kind: 'executed'
      data: unknown
      operation: ProjectAgentOperationDefinition
      outcome: Exclude<ProjectAgentOperationOutcome, { kind: 'wait_approval' } | { kind: 'failed' }>
    }
  | {
      kind: 'approval_required'
      operation: ProjectAgentOperationDefinition
      outcome: Extract<ProjectAgentOperationOutcome, { kind: 'wait_approval' }>
    }

function requireOperation(
  registry: ProjectAgentOperationRegistry,
  operationId: string,
): ProjectAgentOperationDefinition {
  const operation = registry[operationId]
  if (!operation) {
    throw new ApiError('NOT_FOUND', {
      code: 'OPERATION_NOT_FOUND',
      operationId,
      message: `operation not found: ${operationId}`,
    })
  }
  return operation
}

function normalizeInvocationInput(params: {
  channel: OperationInvocationChannel
  operation: ProjectAgentOperationDefinition
  context: ProjectAgentOperationContext['context']
  input: unknown
  approvedInvocation?: PlannedOperationInvocation | null
}): {
  businessInput: unknown
  invocation: PlannedOperationInvocation | null
} {
  const split = splitPlannedOperationInvocation(params.input)
  if (split.invocation && params.approvedInvocation) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_PLAN_INVOCATION_AMBIGUOUS',
      operationId: params.operation.id,
      message: 'operation approval provenance must have exactly one source',
    })
  }
  const businessInput = params.channel === 'tool'
    ? resolveOperationScopeInput({
        input: split.businessInput,
        context: params.context,
        prerequisites: params.operation.prerequisites,
      })
    : split.businessInput
  return {
    businessInput,
    invocation: params.approvedInvocation ?? split.invocation,
  }
}

function assertPrerequisites(params: {
  operation: ProjectAgentOperationDefinition
  input: unknown
  context: ProjectAgentOperationContext['context']
}): string {
  const effectiveEpisode = resolveOperationEffectiveEpisodeId({
    input: params.input,
    context: params.context,
  })
  const hasEpisodeId = effectiveEpisode.episodeId.length > 0
  if (params.operation.prerequisites.episodeId === 'required' && !hasEpisodeId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_PREREQUISITE_MISSING',
      operationId: params.operation.id,
      prerequisite: 'episodeId',
      required: 'required',
      actual: null,
      message: 'PROJECT_AGENT_OPERATION_PREREQUISITE_EPISODE_REQUIRED',
    })
  }
  if (params.operation.prerequisites.episodeId === 'forbidden' && hasEpisodeId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_PREREQUISITE_MISSING',
      operationId: params.operation.id,
      prerequisite: 'episodeId',
      required: 'forbidden',
      actual: effectiveEpisode.episodeId,
      source: effectiveEpisode.source,
      message: 'PROJECT_AGENT_OPERATION_PREREQUISITE_EPISODE_FORBIDDEN',
    })
  }
  return effectiveEpisode.episodeId
}

function operationMayCompleteWithoutTasks(operation: ProjectAgentOperationDefinition): boolean {
  // An approved plan is allowed to contain zero Tasks: that is the registry
  // declared Noop case. A direct transactional-task operation, by contrast,
  // declares that its successful tool execution has atomically submitted a
  // Task batch; it must fail closed if no committed receipt exists.
  return operation.confirmation.kind === 'billable_media'
}

function operationRequiresTaskBatchBinding(operation: ProjectAgentOperationDefinition): boolean {
  return operation.effects.writes
    && (
      operation.confirmation.kind === 'billable_media'
      || operation.assistantWriteAuthority?.kind === 'transactional_task_submission'
    )
}

export function prepareProjectAgentOperationInput(params: {
  channel: OperationInvocationChannel
  operation: ProjectAgentOperationDefinition
  context: ProjectAgentOperationContext['context']
  input: unknown
  approvedInvocation?: PlannedOperationInvocation | null
}): {
  input: unknown
  invocation: PlannedOperationInvocation | null
  effectiveEpisodeId: string
} {
  assertOperationChannelAllowed(params.operation, params.channel)
  const normalized = normalizeInvocationInput(params)
  const normalizedBusinessInput = params.channel === 'tool'
    ? normalizeProjectAgentToolInput({
        operationId: params.operation.id,
        input: normalized.businessInput,
        inputSchema: params.operation.inputSchema,
        toolInputSchema: params.operation.toolInputSchema,
      })
    : normalized.businessInput
  const effectiveEpisodeId = assertPrerequisites({
    operation: params.operation,
    input: normalizedBusinessInput,
    context: params.context,
  })
  const parsedInput = params.operation.inputSchema.safeParse(normalizedBusinessInput)
  if (!parsedInput.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_INPUT_INVALID',
      operationId: params.operation.id,
      message: 'PROJECT_AGENT_INVALID_OPERATION_INPUT',
      issues: parsedInput.error.issues,
      corrections: buildProjectAgentToolInputCorrections({
        input: normalizedBusinessInput,
        toolInputSchema: params.operation.toolInputSchema,
        issues: parsedInput.error.issues,
      }),
    })
  }
  return {
    input: parsedInput.data,
    invocation: normalized.invocation,
    effectiveEpisodeId,
  }
}

/**
 * The sole runtime authority for invoking a registered Assistant operation.
 * Adapters may provide source context and translate the result/error shape, but
 * may not reinterpret channels, prerequisites, approval provenance, execution
 * behavior, or schemas.
 */
export async function invokeProjectAgentOperation(params: {
  registry: ProjectAgentOperationRegistry
  channel: OperationInvocationChannel
  operationId: string
  context: ProjectAgentOperationContext
  input: unknown
  approvedInvocation?: PlannedOperationInvocation | null
  returnApprovalRequired?: boolean
  transaction?: Prisma.TransactionClient
  invocationMode?: 'default' | 'atomic_choice_commit'
}): Promise<ProjectAgentOperationInvocationResult> {
  const operation = requireOperation(params.registry, params.operationId)
  const invocationMode = params.invocationMode ?? 'default'
  const atomicChoiceCommit = invocationMode === 'atomic_choice_commit'
  if (Boolean(params.transaction) !== atomicChoiceCommit) {
    throw new Error(`PROJECT_AGENT_OPERATION_TRANSACTION_MODE_INVALID:${params.operationId}:${invocationMode}`)
  }
  const executionFence = params.context.executionFence ?? null
  if (params.channel === 'tool' && !executionFence) {
    throw new Error(`PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REQUIRED:${params.operationId}`)
  }
  if (executionFence && !params.transaction) {
    await assertProjectAgentOperationExecutionFenceCurrent(executionFence)
  }

  const invoke = async (): Promise<ProjectAgentOperationInvocationResult> => {
  if (params.channel === 'tool') {
    assertAssistantToolWriteAuthority(
      operation.id,
      operation as unknown as Record<string, unknown>,
    )
    if (operationRequiresTaskBatchBinding(operation) && !params.context.taskBatchBinding) {
      throw new Error(`PROJECT_AGENT_OPERATION_TASK_BATCH_BINDING_REQUIRED:${operation.id}`)
    }
  }
  if (
    atomicChoiceCommit
    && (
      operation.choiceCommit?.enabled !== true
      || operation.channels.tool !== true
      || operation.intent !== 'act'
      || !operation.effects.writes
      || operation.effects.billable
      || operation.effects.destructive
      || operation.effects.bulk
      || operation.effects.longRunning
      || operation.effects.externalSideEffects
      || operation.confirmation.kind !== 'none'
      || operation.agentFlow?.suspendsFor
      || !operation.executeInTransaction
    )
  ) {
    throw new Error(`PROJECT_AGENT_CHOICE_COMMIT_OPERATION_CONTRACT_INVALID:${operation.id}`)
  }
  const prepared = prepareProjectAgentOperationInput({
    channel: params.channel,
    operation,
    context: params.context.context,
    input: params.input,
    approvedInvocation: params.approvedInvocation,
  })
  const parsedInput = prepared.input
  const affectedResources = operation.effects.writes
    ? resolveWorkspaceResourceRefs({
        impact: operation.effects.workspaceResourceImpact,
        projectId: params.context.projectId,
        episodeId: prepared.effectiveEpisodeId || null,
      })
    : []
  if (
    affectedResources.length > 0
    && operation.confirmation.kind === 'billable_media'
  ) {
    throw new Error(`OPERATION_RESOURCE_TASK_TERMINAL_REQUIRED:${operation.id}`)
  }
  if (
    affectedResources.length > 0
    && !operation.executeInTransaction
  ) {
    throw new Error(`OPERATION_RESOURCE_TRANSACTION_REQUIRED:${operation.id}`)
  }
  const resourceInvocationId = randomUUID()

  const parseOutput = (value: unknown): unknown => {
    const parsedOutput = operation.outputSchema.safeParse(value)
    if (!parsedOutput.success) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'OPERATION_OUTPUT_INVALID',
        operationId: operation.id,
        message: `operation output schema mismatch: ${operation.id}`,
        issues: parsedOutput.error.issues,
      })
    }
    return parsedOutput.data
  }

  let parsedOutputData: unknown
  if (operation.confirmation.kind === 'billable_media') {
    if (!prepared.invocation) {
      if (params.returnApprovalRequired) {
        return { kind: 'approval_required', operation, outcome: { kind: 'wait_approval' } }
      }
      throw new ApiError('INVALID_PARAMS', {
        code: 'OPERATION_APPROVAL_GRANT_REQUIRED',
        operationId: operation.id,
        message: 'approve the immutable operation plan before execution',
      })
    }
    const result = await invokeApprovedOperationPlan({
      operation,
      ctx: params.context,
      normalizedInput: parsedInput,
      invocation: prepared.invocation,
    })
    parsedOutputData = parseOutput(result)
  } else {
    if (prepared.invocation) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'APPROVAL_GRANT_NOT_APPLICABLE',
        operationId: operation.id,
        message: 'approval provenance is only valid for billable media operations',
      })
    }
    const executeInTransaction = operation.executeInTransaction
    if (executeInTransaction) {
      if (params.transaction && operation.prepareTransaction) {
        throw new Error(`OPERATION_EXTERNAL_PREPARE_OUTER_TRANSACTION_FORBIDDEN:${operation.id}`)
      }
      const preparedTransaction = operation.prepareTransaction
        ? await operation.prepareTransaction(params.context, parsedInput)
        : undefined
      let transactionOutput: unknown
      let hasTransactionOutput = false
      const executeTransaction = async (tx: Prisma.TransactionClient): Promise<unknown> => {
        if (executionFence) {
          await assertProjectAgentOperationExecutionFenceInTransaction(tx, executionFence)
        }
        const output = await executeInTransaction(params.context, parsedInput, tx, preparedTransaction)
        transactionOutput = output
        hasTransactionOutput = true
        if (executionFence) {
          await assertProjectAgentOperationExecutionFenceInTransaction(tx, executionFence)
        }
        const parsed = parseOutput(output)
        if (affectedResources.length > 0) {
          await createWorkspaceResourceBroadcastsInTransaction({
            tx,
            invocationId: resourceInvocationId,
            affectedResources,
            userId: params.context.userId,
            operationId: operation.id,
          })
        }
        return parsed
      }
      if (params.transaction) {
        // Atomic choice commit: the outer transaction owner commits and owns
        // any post-commit dispatch; nothing has committed at this point.
        parsedOutputData = await executeTransaction(params.transaction)
      } else {
        const outboxCollector = createOutboxCommitCollector()
        try {
          parsedOutputData = await prisma.$transaction(async (tx) => {
            outboxCollector.bindTransaction(tx)
            return await executeTransaction(tx)
          })
        } catch (error) {
          if (operation.compensateTransactionFailure) {
            try {
              await operation.compensateTransactionFailure(
                params.context,
                parsedInput,
                preparedTransaction,
                hasTransactionOutput ? transactionOutput : null,
                error,
              )
            } catch (compensationError) {
              throw new AggregateError(
                [error, compensationError],
                `OPERATION_TRANSACTION_COMPENSATION_FAILED:${operation.id}`,
              )
            }
          }
          throw error
        }
        // Commit succeeded: hand the exact command ids created inside this
        // transaction to the existing fast dispatch. A transport failure only
        // logs; the periodic dispatcher recovers from the same durable rows.
        await dispatchCommittedOutboxCommands(outboxCollector.commandIds)
      }
    } else {
      const execute = operation.execute
      if (!execute) {
        throw new Error(`DIRECT_OPERATION_EXECUTOR_MISSING:${operation.id}`)
      }
      const result = await execute(params.context, parsedInput)
      if (
        params.channel === 'tool'
        && operation.effects.writes
        && operation.assistantWriteAuthority?.kind === 'transactional_task_submission'
        && !params.context.taskBatchBinding?.isCommitted()
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_TASK_SUBMISSION_NOT_COMMITTED:${operation.id}`)
      }
      parsedOutputData = parseOutput(result)
    }
  }
  const choiceHandoff = executionFence && operation.agentFlow?.suspendsFor === 'choice'
    ? requireProjectAgentChoiceHandoffReceipt({
        fence: executionFence,
        operationId: operation.id,
      })
    : null
  const taskSubmission = params.context.taskBatchBinding?.getCommittedReceipt() ?? null
  const outcome: Exclude<ProjectAgentOperationOutcome, { kind: 'wait_approval' } | { kind: 'failed' }> = choiceHandoff
    ? { kind: 'wait_choice', data: parsedOutputData, choiceHandoff }
    : taskSubmission
      ? { kind: 'submitted_tasks', data: parsedOutputData, receipt: taskSubmission }
      : params.channel === 'tool' && operationMayCompleteWithoutTasks(operation)
        ? { kind: 'noop', data: parsedOutputData }
        : { kind: 'completed', data: parsedOutputData }
  return {
    kind: 'executed',
    data: parsedOutputData,
    operation,
    outcome,
  }
  }

  return executionFence
    ? await runWithProjectAgentOperationExecutionFence(executionFence, invoke)
    : await invoke()
}
