import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import {
  invokeProjectAgentOperation,
  prepareProjectAgentOperationInput,
} from '@/lib/operations/invocation'
import {
  buildDirectOperationInvocationIdentity,
  executeApprovedTaskOperationViaTemporal,
  executeDirectTaskOperationViaTemporal,
} from '@/lib/operations/durable-dispatch'
import { isBillablePlannedOperation } from '@/lib/operations/types'
import {
  extractPrismaMissingColumn,
} from '@/lib/adapters/operation-error-normalizer'
import { normalizeAnyError } from '@/lib/errors/normalize'
import {
  OPERATION_MUTATION_RESPONSE_PROTOCOL,
  type OperationMutationResponse,
} from '@/lib/operations/mutation-receipt'
import { WORKSPACE_RESOURCE_IMPACT } from '@/lib/workspace-resource/resource-impact'
import { readOperationRequestId } from '@/lib/operations/api-request-identity'

interface ExecuteProjectAgentOperationFromApiParams {
  request: NextRequest
  operationId: string
  projectId: string
  userId: string
  context?: {
    locale?: string | null
    selectedScopeRef?: string | null
    selectedAssetId?: string | null
  }
  input: unknown
  source?: string
  responseContract?: 'operation_mutation_response_v1'
  requireIdempotencyKey?: boolean
}

export async function executeProjectAgentOperationFromApi(
  params: ExecuteProjectAgentOperationFromApiParams & {
    responseContract: 'operation_mutation_response_v1'
  },
): Promise<OperationMutationResponse>
export async function executeProjectAgentOperationFromApi(
  params: ExecuteProjectAgentOperationFromApiParams & {
    responseContract?: undefined
  },
): Promise<unknown>
export async function executeProjectAgentOperationFromApi(
  params: ExecuteProjectAgentOperationFromApiParams,
): Promise<unknown> {
  const apiRequestId = readOperationRequestId(params.request, {
    required: Boolean(params.requireIdempotencyKey),
    operationId: params.operationId,
  })
  const registry = createProjectAgentOperationRegistryForApi()
  const operation = registry[params.operationId]
  const requiresMutationResponse = Boolean(
    operation?.effects.writes
    && operation.effects.workspaceResourceImpact !== WORKSPACE_RESOURCE_IMPACT.NONE,
  )
  const requestedMutationResponse =
    params.responseContract === OPERATION_MUTATION_RESPONSE_PROTOCOL
  if (
    operation
    && requiresMutationResponse !== requestedMutationResponse
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: requiresMutationResponse
        ? 'OPERATION_MUTATION_RESPONSE_CONTRACT_REQUIRED'
        : 'OPERATION_MUTATION_RESPONSE_CONTRACT_FORBIDDEN',
      operationId: params.operationId,
    })
  }
  const operationContext = {
    request: params.request,
    requestId: apiRequestId,
    userId: params.userId,
    projectId: params.projectId,
    context: {
      ...(params.context?.locale ? { locale: params.context.locale } : {}),
      ...(params.context?.selectedScopeRef ? { selectedScopeRef: params.context.selectedScopeRef } : {}),
      ...(params.context?.selectedAssetId ? { selectedAssetId: params.context.selectedAssetId } : {}),
    },
    source: params.source || 'project-ui',
    writer: null,
    toolCallId: null,
    activityId: null,
  }

  try {
    if (operation && isBillablePlannedOperation(operation)) {
      const prepared = await prepareProjectAgentOperationInput({
        channel: 'api',
        operation,
        context: operationContext,
        input: params.input,
      })
      if (!prepared.invocation) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'OPERATION_APPROVAL_GRANT_REQUIRED',
          operationId: operation.id,
          message: 'approve the immutable operation plan before execution',
        })
      }
      const result = await executeApprovedTaskOperationViaTemporal({
        registry,
        operationId: operation.id,
        userId: params.userId,
        projectId: params.projectId,
        source: operationContext.source,
        invocation: prepared.invocation,
        context: operationContext.context,
        origin: { kind: 'api' },
      })
      return result.data
    }
    if (
      operation?.assistantWriteAuthority?.kind
        === 'temporal_operation_execution'
    ) {
      const stableSourceId = apiRequestId
      if (!stableSourceId) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'OPERATION_IDEMPOTENCY_KEY_REQUIRED',
          header: 'Idempotency-Key',
          operationId: params.operationId,
        })
      }
      const identity = buildDirectOperationInvocationIdentity({
        channel: 'api',
        projectId: params.projectId,
        operationId: params.operationId,
        stableSourceId,
      })
      const result = await executeDirectTaskOperationViaTemporal({
        registry,
        channel: 'api',
        operationId: params.operationId,
        userId: params.userId,
        projectId: params.projectId,
        source: operationContext.source,
        context: operationContext.context,
        input: params.input,
        ...identity,
        origin: { kind: 'api' },
      })
      return result.data
    }
    const result = await invokeProjectAgentOperation({
      registry,
      channel: 'api',
      operationId: params.operationId,
      context: operationContext,
      input: params.input,
    })
    if (result.kind !== 'executed') {
      throw new Error(`API_OPERATION_APPROVAL_RESULT_INVALID:${params.operationId}`)
    }
    if (requestedMutationResponse) {
      if (!result.mutationReceipt || result.mutationReceipt.changedRefs.length === 0) {
        throw new Error(
          `OPERATION_MUTATION_RESPONSE_RECEIPT_REQUIRED:${params.operationId}`,
        )
      }
      return {
        protocol: OPERATION_MUTATION_RESPONSE_PROTOCOL,
        data: result.data,
        mutationReceipt: result.mutationReceipt,
      } satisfies OperationMutationResponse
    }
    if (result.mutationReceipt?.changedRefs.length) {
      throw new Error(
        `OPERATION_MUTATION_RESPONSE_CONTRACT_REQUIRED:${params.operationId}`,
      )
    }
    return result.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    const missingColumn = extractPrismaMissingColumn(error)
    if (missingColumn) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'DATABASE_SCHEMA_MISMATCH',
        field: missingColumn,
      }, { cause: error })
    }
    const normalized = normalizeAnyError(error, {
      fallbackCode: 'EXTERNAL_ERROR',
    })
    throw ApiError.fromFailure(normalized, error)
  }
}
