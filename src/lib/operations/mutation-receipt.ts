import { resolveWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import { requireWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import type {
  OperationMutationReceipt,
  ProjectAgentOperationDefinition,
} from './types'

export const OPERATION_MUTATION_RESPONSE_PROTOCOL =
  'operation_mutation_response_v1' as const

export interface OperationMutationResponse<T = unknown> {
  protocol: typeof OPERATION_MUTATION_RESPONSE_PROTOCOL
  data: T
  mutationReceipt: OperationMutationReceipt
}

/**
 * Project the formal result of a synchronous transaction-owned mutation from
 * its registry declaration and canonical invocation scope.
 *
 * Operation output is intentionally absent: output shape is not an authority
 * for resource ownership or invalidation.
 */
export function projectOperationMutationReceipt(params: {
  operation: ProjectAgentOperationDefinition
  projectId: string
}): OperationMutationReceipt {
  if (!params.operation.effects.writes) {
    throw new Error(
      `OPERATION_MUTATION_RECEIPT_WRITE_REQUIRED:${params.operation.id}`,
    )
  }
  if (!params.operation.executeInTransaction) {
    throw new Error(
      `OPERATION_MUTATION_RECEIPT_TRANSACTION_REQUIRED:${params.operation.id}`,
    )
  }

  return {
    protocol: 'operation_mutation_receipt_v1',
    operationId: params.operation.id,
    changedRefs: resolveWorkspaceResourceRefs({
      impact: params.operation.effects.workspaceResourceImpact,
      projectId: params.projectId,
    }),
  }
}

export function parseOperationMutationReceipt(
  value: unknown,
): OperationMutationReceipt | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OPERATION_MUTATION_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (
    record.protocol !== 'operation_mutation_receipt_v1'
    || typeof record.operationId !== 'string'
    || !record.operationId.trim()
  ) {
    throw new Error('OPERATION_MUTATION_RECEIPT_INVALID')
  }
  return {
    protocol: 'operation_mutation_receipt_v1',
    operationId: record.operationId,
    changedRefs: requireWorkspaceResourceRefs(record.changedRefs),
  }
}

/**
 * Strict wire parser for synchronous Operation mutation responses.
 *
 * `data` deliberately stays unknown: each domain consumer may validate its
 * own business result, while this shared boundary is the only interpreter of
 * the changed-ref receipt.
 */
export function requireOperationMutationResponse(
  value: unknown,
): OperationMutationResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OPERATION_MUTATION_RESPONSE_INVALID')
  }
  const record = value as Record<string, unknown>
  if (record.protocol !== OPERATION_MUTATION_RESPONSE_PROTOCOL) {
    throw new Error('OPERATION_MUTATION_RESPONSE_INVALID')
  }
  const mutationReceipt = parseOperationMutationReceipt(record.mutationReceipt)
  if (!mutationReceipt || mutationReceipt.changedRefs.length === 0) {
    throw new Error('OPERATION_MUTATION_RESPONSE_INVALID')
  }
  return {
    protocol: OPERATION_MUTATION_RESPONSE_PROTOCOL,
    data: record.data,
    mutationReceipt,
  }
}
