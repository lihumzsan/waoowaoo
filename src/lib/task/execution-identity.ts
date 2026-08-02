import { createHash } from 'node:crypto'
import type { CreateTaskInput } from './types'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]))
}

export function createTaskExecutionFingerprint(input: CreateTaskInput): string {
  const immutableInput = {
    userId: input.userId,
    projectId: input.projectId,
    parentTaskId: input.parentTaskId ?? null,
    type: input.type,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.payload ?? null,
    operationId: input.operationId ?? null,
    operationSource: input.operationSource ?? null,
    approvalGrantId: input.approvalGrantId ?? null,
    operationExecutionId: input.operationExecutionId ?? null,
    operationPlanTaskId: input.operationPlanTaskId ?? null,
    operationRequestId: input.operationRequestId ?? null,
  }
  return createHash('sha256').update(JSON.stringify(canonicalize(immutableInput))).digest('hex')
}
