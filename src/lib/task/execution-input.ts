import { resolveTaskLocaleFromBody } from './resolve-locale'
import { parseTaskBillingInfo } from './billing-info'
import {
  isTaskType,
  type TaskExecutionData,
  type TaskType,
} from './types'

export type TaskExecutionDataSource = {
  id: string
  parentTaskId: string | null
  type: string
  projectId: string
  targetType: string
  targetId: string
  payload: unknown
  billingInfo: unknown
  userId: string
  operationId: string | null
  operationSource: string | null
  approvalGrantId: string | null
  operationExecutionId: string | null
  operationPlanTaskId: string | null
  operationRequestId: string | null
}

function requireTaskType(value: string): TaskType {
  if (!isTaskType(value)) {
    throw new Error(`invalid task type: ${value}`)
  }
  return value
}

function parsePayload(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('task payload must be an object or null')
  }
  return value as Record<string, unknown>
}

function readTraceRequestId(
  payload: Record<string, unknown> | null,
  operationRequestId: string | null,
): string | null {
  const meta = payload?.meta
  const metaRecord = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : null
  const trace = metaRecord?.trace
  const traceRecord = trace && typeof trace === 'object' && !Array.isArray(trace)
    ? trace as Record<string, unknown>
    : null
  const requestId = traceRecord?.requestId
  if (typeof requestId === 'string' && requestId.trim()) {
    return requestId.trim()
  }
  return operationRequestId
}

/**
 * The only DB Task -> execution input projection.
 *
 * Temporal Activities always rebuild this value from the authoritative Task row;
 * no transport-specific payload becomes a second source of business identity.
 */
export function buildTaskExecutionData(
  source: TaskExecutionDataSource,
): TaskExecutionData {
  const type = requireTaskType(source.type)
  const payload = parsePayload(source.payload)
  const locale = resolveTaskLocaleFromBody(payload)
  if (!locale) {
    throw new Error('task locale is missing')
  }

  return {
    taskId: source.id,
    parentTaskId: source.parentTaskId,
    type,
    locale,
    projectId: source.projectId,
    targetType: source.targetType,
    targetId: source.targetId,
    payload,
    billingInfo: parseTaskBillingInfo(source.billingInfo, type),
    userId: source.userId,
    operationId: source.operationId,
    operationSource: source.operationSource,
    approvalGrantId: source.approvalGrantId,
    operationExecutionId: source.operationExecutionId,
    operationPlanTaskId: source.operationPlanTaskId,
    operationRequestId: source.operationRequestId,
    trace: {
      requestId: readTraceRequestId(payload, source.operationRequestId),
    },
  }
}
