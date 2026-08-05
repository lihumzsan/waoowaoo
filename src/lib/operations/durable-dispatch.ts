import { createHash } from 'node:crypto'
import { ApiError } from '@/lib/api-errors'
import type { ProjectAgentContext } from '@/lib/project-agent/types'
import {
  OPERATION_EXECUTION_PROTOCOL,
  type ApprovedPlanOperationExecutionCommand,
  type DirectTaskOperationExecutionCommand,
} from '@/lib/temporal/operation-execution/contracts'
import { executeOperationViaTemporal } from '@/lib/temporal/operation-execution/client'
import { loadOperationExecutionOutput } from '@/lib/temporal/operation-execution/output'
import type {
  ProjectAgentOperationDefinition,
  ProjectAgentOperationRegistry,
} from './types'
import { isBillablePlannedOperation } from './types'
import type { PlannedOperationInvocation } from './planned-operation-invocation'
import {
  prepareProjectAgentOperationInput,
  type OperationInvocationChannel,
} from './invocation'

function hashIdentity(parts: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts), 'utf8')
    .digest('base64url')
}

export function buildDirectOperationInvocationIdentity(params: {
  channel: OperationInvocationChannel
  projectId: string
  operationId: string
  stableSourceId: string
}): {
  executionId: string
  operationRequestId: string
} {
  const stableSourceId = params.stableSourceId.trim()
  if (!stableSourceId) {
    throw new Error('OPERATION_EXECUTION_STABLE_SOURCE_ID_REQUIRED')
  }
  const digest = hashIdentity([
    'direct-operation-v1',
    params.channel,
    params.projectId,
    params.operationId,
    stableSourceId,
  ])
  return {
    executionId: `direct-operation:v1:${digest}`,
    operationRequestId: `direct-request:v1:${digest}`,
  }
}

function requireDurableOperation(
  registry: ProjectAgentOperationRegistry,
  operationId: string,
): {
  operation: ProjectAgentOperationDefinition
  contractRevision: string
} {
  const operation = registry[operationId]
  if (!operation) {
    throw new ApiError('NOT_FOUND', {
      code: 'OPERATION_NOT_FOUND',
      operationId,
      message: `operation not found: ${operationId}`,
    })
  }
  const authority = operation.assistantWriteAuthority
  if (
    authority?.kind !== 'temporal_operation_execution'
    || authority.followUpPolicy !== 'after_all_terminal'
  ) {
    throw new Error(
      `OPERATION_TEMPORAL_EXECUTION_AUTHORITY_REQUIRED:${operationId}`,
    )
  }
  return {
    operation,
    contractRevision: authority.contractRevision,
  }
}

export async function executeDirectTaskOperationViaTemporal(params: {
  registry: ProjectAgentOperationRegistry
  channel: OperationInvocationChannel
  operationId: string
  userId: string
  projectId: string
  source: string
  context: ProjectAgentContext
  input: unknown
  executionId: string
  operationRequestId: string
  origin:
    | {
        kind: 'agent_turn'
        turnId: string
        callId: string
      }
    | {
        kind: 'api'
      }
}): Promise<{
  data: unknown
  operation: ProjectAgentOperationDefinition
}> {
  const { operation, contractRevision } = requireDurableOperation(
    params.registry,
    params.operationId,
  )
  const prepared = await prepareProjectAgentOperationInput({
    channel: params.channel,
    operation,
    context: {
      request: null,
      requestId: params.operationRequestId,
      userId: params.userId,
      projectId: params.projectId,
      context: params.context,
      source: params.source,
      writer: null,
      toolCallId: params.origin.kind === 'agent_turn' ? params.origin.callId : null,
      activityId: null,
    },
    input: params.input,
  })
  if (prepared.invocation) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'APPROVAL_GRANT_NOT_APPLICABLE',
      operationId: operation.id,
      message:
        'approval provenance is not valid for a direct durable operation',
    })
  }
  const command: DirectTaskOperationExecutionCommand = {
    protocol: OPERATION_EXECUTION_PROTOCOL,
    kind: 'direct_task',
    executionId: params.executionId,
    userId: params.userId,
    projectId: params.projectId,
    operationId: operation.id,
    operationRequestId: params.operationRequestId,
    source: params.source,
    channel: params.channel,
    executionContractRevision: contractRevision,
    context: {
      locale: params.context.locale?.trim() || null,
      selectedScopeRef: params.context.selectedScopeRef?.trim() || null,
      selectedAssetId: params.context.selectedAssetId?.trim() || null,
      origin: { ...params.origin },
    },
    normalizedInput: prepared.input,
  }
  const receipt = await executeOperationViaTemporal(command)
  const output = await loadOperationExecutionOutput({
    operationExecutionId: receipt.operationExecutionId,
    command,
    outputHash: receipt.outputHash,
  })
  const parsedOutput = operation.outputSchema.safeParse(output)
  if (!parsedOutput.success) {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'OPERATION_OUTPUT_INVALID',
      operationId: operation.id,
      message: `operation output schema mismatch: ${operation.id}`,
      issues: parsedOutput.error.issues,
    })
  }
  return {
    data: parsedOutput.data,
    operation,
  }
}

export async function executeApprovedTaskOperationViaTemporal(params: {
  registry: ProjectAgentOperationRegistry
  operationId: string
  userId: string
  projectId: string
  source: string
  invocation: PlannedOperationInvocation
  context: ProjectAgentContext
  origin:
    | {
        kind: 'agent_turn'
        turnId: string
        callId: string
      }
    | {
        kind: 'api'
      }
}): Promise<{
  data: unknown
  operation: ProjectAgentOperationDefinition
}> {
  const operation = params.registry[params.operationId]
  if (!operation) {
    throw new ApiError('NOT_FOUND', {
      code: 'OPERATION_NOT_FOUND',
      operationId: params.operationId,
      message: `operation not found: ${params.operationId}`,
    })
  }
  if (!isBillablePlannedOperation(operation)) {
    throw new Error(
      `OPERATION_EXECUTION_APPROVED_PLAN_REQUIRED:${params.operationId}`,
    )
  }
  const command: ApprovedPlanOperationExecutionCommand = {
    protocol: OPERATION_EXECUTION_PROTOCOL,
    kind: 'approved_plan',
    executionId: params.invocation.approvalGrantId,
    userId: params.userId,
    projectId: params.projectId,
    operationId: params.operationId,
    approvalGrantId: params.invocation.approvalGrantId,
    operationRequestId: params.invocation.requestId,
    source: params.source,
    context: {
      locale: params.context.locale?.trim() || null,
      selectedScopeRef: params.context.selectedScopeRef?.trim() || null,
      selectedAssetId: params.context.selectedAssetId?.trim() || null,
      origin: { ...params.origin },
    },
  }
  const receipt = await executeOperationViaTemporal(command)
  const output = await loadOperationExecutionOutput({
    operationExecutionId: receipt.operationExecutionId,
    command,
    outputHash: receipt.outputHash,
  })
  const parsedOutput = operation.outputSchema.safeParse(output)
  if (!parsedOutput.success) {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'OPERATION_OUTPUT_INVALID',
      operationId: operation.id,
      message: `operation output schema mismatch: ${operation.id}`,
      issues: parsedOutput.error.issues,
    })
  }
  return {
    data: parsedOutput.data,
    operation,
  }
}
