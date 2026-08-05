import { ApiError } from '@/lib/api-errors'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import { publishOperationMutationReceipt } from '@/lib/workspace-resource/resource-change-publisher'
import { resolveOperationScopeInput } from './environment-input'
import {
  buildProjectAgentToolInputCorrections,
  expandProjectAgentToolInputIssues,
  normalizeProjectAgentToolInput,
} from './tool-input-schema'
import {
  splitPlannedOperationInvocation,
  type PlannedOperationInvocation,
} from './planned-operation-invocation'
import type {
  OperationMutationReceipt,
  ProjectAgentOperationContext,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationRegistry,
} from './types'
import { assertAssistantToolWriteAuthority } from './write-authority'
import { assertOperationChannelAllowed, type OperationInvocationChannel } from './channel-policy'
import { projectOperationMutationReceipt } from './mutation-receipt'

export type { OperationInvocationChannel } from './channel-policy'

export interface ProjectAgentOperationInvocationResult {
  kind: 'executed'
  data: unknown
  operation: ProjectAgentOperationDefinition
  mutationReceipt: OperationMutationReceipt | null
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
  const businessInput =
    params.channel === 'tool'
      ? resolveOperationScopeInput({
          input: split.businessInput,
          context: params.context,
        })
      : split.businessInput
  return {
    businessInput,
    invocation: params.approvedInvocation ?? split.invocation,
  }
}

export async function prepareProjectAgentOperationInput(params: {
  channel: OperationInvocationChannel
  operation: ProjectAgentOperationDefinition
  context: ProjectAgentOperationContext
  input: unknown
  approvedInvocation?: PlannedOperationInvocation | null
}): Promise<{
  input: unknown
  invocation: PlannedOperationInvocation | null
}> {
  assertOperationChannelAllowed(params.operation, params.channel)
  const normalized = normalizeInvocationInput({
    ...params,
    context: params.context.context,
  })
  const toolRuntimeSchema = params.operation.toolInputCanonicalizer?.inputSchema
    ?? params.operation.inputSchema
  const normalizedBusinessInput =
    params.channel === 'tool'
      ? normalizeProjectAgentToolInput({
          operationId: params.operation.id,
          input: normalized.businessInput,
          inputSchema: toolRuntimeSchema,
          toolInputSchema: params.operation.toolInputSchema,
        })
      : normalized.businessInput
  const canonicalInput = params.channel === 'tool' && params.operation.toolInputCanonicalizer
    ? await params.operation.toolInputCanonicalizer.canonicalize(
        params.context,
        normalizedBusinessInput,
      )
    : normalizedBusinessInput
  const parsedInput = params.operation.inputSchema.safeParse(canonicalInput)
  if (!parsedInput.success) {
    const issues = expandProjectAgentToolInputIssues({
      input: canonicalInput,
      toolInputSchema: params.operation.toolInputSchema,
      issues: parsedInput.error.issues,
    })
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_INPUT_INVALID',
      operationId: params.operation.id,
      message: 'PROJECT_AGENT_INVALID_OPERATION_INPUT',
      issues,
      corrections: buildProjectAgentToolInputCorrections({
        input: canonicalInput,
        toolInputSchema: params.operation.toolInputSchema,
        issues,
      }),
    })
  }
  return {
    input: parsedInput.data,
    invocation: normalized.invocation,
  }
}

/**
 * The sole runtime authority for invoking a registered Assistant operation.
 * Adapters may provide source context and translate the result/error shape, but
 * may not reinterpret channels, approval provenance, execution
 * behavior, or schemas.
 */
export async function invokeProjectAgentOperation(params: {
  registry: ProjectAgentOperationRegistry
  channel: OperationInvocationChannel
  operationId: string
  context: ProjectAgentOperationContext
  input: unknown
  approvedInvocation?: PlannedOperationInvocation | null
  transaction?: Prisma.TransactionClient
  invocationMode?:
    | 'default'
    | 'agent_tool_effect'
    | 'durable_operation_execution'
}): Promise<ProjectAgentOperationInvocationResult> {
  const operation = requireOperation(params.registry, params.operationId)
  if (params.context.invocationChannel && params.context.invocationChannel !== params.channel) {
    throw new Error(
      `PROJECT_AGENT_OPERATION_CHANNEL_CONTEXT_MISMATCH:${params.operationId}:${params.channel}:${params.context.invocationChannel}`,
    )
  }
  params.context.invocationChannel = params.channel
  const invocationMode = params.invocationMode ?? 'default'
  const agentToolEffect = invocationMode === 'agent_tool_effect'
  const durableOperationExecution = invocationMode === 'durable_operation_execution'
  if (Boolean(params.transaction) !== agentToolEffect) {
    throw new Error(
      `PROJECT_AGENT_OPERATION_TRANSACTION_MODE_INVALID:${params.operationId}:${invocationMode}`,
    )
  }
  if (
    params.channel === 'tool' &&
    !durableOperationExecution &&
    !agentToolEffect &&
    operation.effects.writes
  ) {
    throw new Error(`PROJECT_AGENT_OPERATION_DURABLE_WRITE_OWNER_REQUIRED:${params.operationId}`)
  }

  if (params.channel === 'tool') {
    assertAssistantToolWriteAuthority(operation.id, operation as unknown as Record<string, unknown>)
  }
  if (
    durableOperationExecution &&
    (operation.assistantWriteAuthority?.kind !== 'temporal_operation_execution' ||
      !params.context.operationExecutionId?.trim() ||
      !params.context.requestId?.trim() ||
      params.transaction)
  ) {
    throw new Error(`PROJECT_AGENT_OPERATION_DURABLE_EXECUTION_CONTRACT_INVALID:${operation.id}`)
  }
  if (
    agentToolEffect &&
    (params.channel !== 'tool' ||
      (operation.intent !== 'act' && operation.intent !== 'plan') ||
      !operation.effects.writes ||
      operation.effects.billable ||
      operation.effects.externalSideEffects ||
      operation.effects.longRunning ||
      (
        operation.confirmation.kind !== 'none'
        && !(
          operation.confirmation.kind === 'destructive'
          && params.context.destructiveApprovalVerified === true
        )
      ) ||
      !operation.executeInTransaction ||
      operation.prepareTransaction ||
      operation.compensateTransactionFailure ||
      !params.transaction)
  ) {
    throw new Error(`PROJECT_AGENT_OPERATION_TOOL_EFFECT_CONTRACT_INVALID:${operation.id}`)
  }
  const prepared = await prepareProjectAgentOperationInput({
    channel: params.channel,
    operation,
    context: params.context,
    input: params.input,
    approvedInvocation: params.approvedInvocation,
  })
  const parsedInput = prepared.input
  const affectedResources = operation.effects.writes
    ? resolveWorkspaceResourceRefs({
        impact: operation.effects.workspaceResourceImpact,
        projectId: params.context.projectId,
      })
    : []
  if (affectedResources.length > 0 && operation.confirmation.kind === 'billable_media') {
    throw new Error(`OPERATION_RESOURCE_TASK_TERMINAL_REQUIRED:${operation.id}`)
  }
  if (affectedResources.length > 0 && !operation.executeInTransaction) {
    throw new Error(`OPERATION_RESOURCE_TRANSACTION_REQUIRED:${operation.id}`)
  }
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
  let mutationReceipt: OperationMutationReceipt | null = null
  if (operation.confirmation.kind === 'billable_media') {
    throw new Error(`OPERATION_BILLABLE_DURABLE_EXECUTION_REQUIRED:${operation.id}`)
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
        const output = await executeInTransaction(
          params.context,
          parsedInput,
          tx,
          preparedTransaction,
        )
        transactionOutput = output
        hasTransactionOutput = true
        const parsed = parseOutput(output)
        return parsed
      }
      if (params.transaction) {
        // The outer ToolEffect owner commits and owns post-commit dispatch.
        parsedOutputData = await executeTransaction(params.transaction)
      } else {
        try {
          parsedOutputData = await prisma.$transaction(async (tx) => {
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
      }
      mutationReceipt = projectOperationMutationReceipt({
        operation,
        projectId: params.context.projectId,
      })
      if (!params.transaction) {
        await publishOperationMutationReceipt({
          projectId: params.context.projectId,
          userId: params.context.userId,
          receipt: mutationReceipt,
        })
      }
    } else {
      const execute = operation.execute
      if (!execute) {
        throw new Error(`DIRECT_OPERATION_EXECUTOR_MISSING:${operation.id}`)
      }
      const result = await execute(params.context, parsedInput)
      parsedOutputData = parseOutput(result)
    }
  }
  return {
    kind: 'executed',
    data: parsedOutputData,
    operation,
    mutationReceipt,
  }
}
