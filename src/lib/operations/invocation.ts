import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import {
  assertProjectAgentOperationExecutionFenceAfterInvocation,
  assertProjectAgentOperationExecutionFenceCurrent,
  assertProjectAgentOperationExecutionFenceInTransaction,
  runWithProjectAgentOperationExecutionFence,
} from '@/lib/project-agent/operation-execution-fence'
import { publishWorkspaceResourceChangedEventsFromWriteResult } from '@/lib/workspace-resource/resource-change-events'
import { resolveOperationEffectiveEpisodeId, resolveOperationScopeInput } from './environment-input'
import {
  invokeApprovedOperationPlan,
  splitPlannedOperationInvocation,
  type PlannedOperationInvocation,
} from './planned-operation-invocation'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationRegistry,
} from './types'
import { assertAssistantToolWriteAuthority } from './write-authority'

export type OperationInvocationChannel = 'api' | 'tool'

export type ProjectAgentOperationInvocationResult =
  | {
      kind: 'executed'
      data: unknown
      operation: ProjectAgentOperationDefinition
    }
  | {
      kind: 'approval_required'
      operation: ProjectAgentOperationDefinition
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

function assertChannelAllowed(
  operation: ProjectAgentOperationDefinition,
  channel: OperationInvocationChannel,
): void {
  if (operation.channels[channel]) return
  throw new ApiError('FORBIDDEN', {
    code: 'OPERATION_NOT_ALLOWED',
    operationId: operation.id,
    channel,
    message: `operation ${operation.id} is not available through the ${channel} channel`,
  })
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
}): Promise<ProjectAgentOperationInvocationResult> {
  const operation = requireOperation(params.registry, params.operationId)
  const executionFence = params.context.executionFence ?? null
  if (params.channel === 'tool' && !executionFence) {
    throw new Error(`PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REQUIRED:${params.operationId}`)
  }
  if (executionFence) {
    await assertProjectAgentOperationExecutionFenceCurrent(executionFence)
  }

  const invoke = async (): Promise<ProjectAgentOperationInvocationResult> => {
  assertChannelAllowed(operation, params.channel)
  if (params.channel === 'tool') {
    assertAssistantToolWriteAuthority(
      operation.id,
      operation as unknown as Record<string, unknown>,
    )
  }
  const normalized = normalizeInvocationInput({
    channel: params.channel,
    operation,
    context: params.context.context,
    input: params.input,
    approvedInvocation: params.approvedInvocation,
  })
  const effectiveEpisodeId = assertPrerequisites({
    operation,
    input: normalized.businessInput,
    context: params.context.context,
  })
  const parsedInput = operation.inputSchema.safeParse(normalized.businessInput)
  if (!parsedInput.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_INPUT_INVALID',
      operationId: operation.id,
      message: 'PROJECT_AGENT_INVALID_OPERATION_INPUT',
      issues: parsedInput.error.issues,
    })
  }

  let result: unknown
  if (operation.confirmation.kind === 'billable_media') {
    if (!normalized.invocation) {
      if (params.returnApprovalRequired) {
        return { kind: 'approval_required', operation }
      }
      throw new ApiError('INVALID_PARAMS', {
        code: 'OPERATION_APPROVAL_GRANT_REQUIRED',
        operationId: operation.id,
        message: 'approve the immutable operation plan before execution',
      })
    }
    result = await invokeApprovedOperationPlan({
      operation,
      ctx: params.context,
      normalizedInput: parsedInput.data,
      invocation: normalized.invocation,
    })
  } else {
    if (normalized.invocation) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'APPROVAL_GRANT_NOT_APPLICABLE',
        operationId: operation.id,
        message: 'approval provenance is only valid for billable media operations',
      })
    }
    const executeInTransaction = operation.executeInTransaction
    if (executeInTransaction) {
      result = await prisma.$transaction(async (tx) => {
        if (executionFence) {
          await assertProjectAgentOperationExecutionFenceInTransaction(tx, executionFence)
        }
        const output = await executeInTransaction(params.context, parsedInput.data, tx)
        if (executionFence) {
          await assertProjectAgentOperationExecutionFenceInTransaction(tx, executionFence)
        }
        return output
      })
    } else {
      const execute = operation.execute
      if (!execute) {
        throw new Error(`DIRECT_OPERATION_EXECUTOR_MISSING:${operation.id}`)
      }
      if (
        params.channel === 'tool'
        && operation.effects.writes
        && operation.assistantWriteAuthority?.kind === 'transactional_task_submission'
        && !params.context.taskBatchBinding
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_TASK_BATCH_BINDING_REQUIRED:${operation.id}`)
      }
      result = await execute(params.context, parsedInput.data)
      if (
        params.channel === 'tool'
        && operation.effects.writes
        && operation.assistantWriteAuthority?.kind === 'transactional_task_submission'
        && !params.context.taskBatchBinding?.isCommitted()
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_TASK_SUBMISSION_NOT_COMMITTED:${operation.id}`)
      }
    }
  }

  const parsedOutput = operation.outputSchema.safeParse(result)
  if (!parsedOutput.success) {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'OPERATION_OUTPUT_INVALID',
      operationId: operation.id,
      message: `operation output schema mismatch: ${operation.id}`,
      issues: parsedOutput.error.issues,
    })
  }
  if (executionFence && !operation.effects.writes) {
    await assertProjectAgentOperationExecutionFenceAfterInvocation(executionFence)
  }
  await publishWorkspaceResourceChangedEventsFromWriteResult({
    result: parsedOutput.data,
    fallbackProjectId: params.context.projectId,
    userId: params.context.userId,
    fallbackEpisodeId: effectiveEpisodeId || null,
  })
  return {
    kind: 'executed',
    data: parsedOutput.data,
    operation,
  }
  }

  return executionFence
    ? await runWithProjectAgentOperationExecutionFence(executionFence, invoke)
    : await invoke()
}
