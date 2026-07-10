import { resolveTaskLocaleFromBody } from './resolve-locale'
import { parseTaskBillingInfo } from './billing-info'
import {
  TASK_TYPE,
  type TaskJobData,
  type TaskJobEnvelope,
  type TaskType,
} from './types'

const TASK_TYPES: ReadonlySet<string> = new Set(Object.values(TASK_TYPE))

export type TaskJobEnvelopeSource = {
  id: string
  parentTaskId: string | null
  type: string
  projectId: string
  episodeId: string | null
  targetType: string
  targetId: string
  payload: unknown
  batchKey: string | null
  billingInfo: unknown
  userId: string
  operationId: string | null
  operationSource: string | null
  approvalGrantId: string | null
  operationExecutionId: string | null
  operationPlanTaskId: string | null
  operationRequestId: string | null
  priority: number
}

function requireTaskType(value: string): TaskType {
  if (!TASK_TYPES.has(value)) {
    throw new Error(`invalid task type: ${value}`)
  }
  return value as TaskType
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
 * The only DB Task -> BullMQ job conversion.
 * Recovery and initial submission must use this complete envelope so metadata cannot
 * disappear when a job is reconstructed after Redis or process recovery.
 */
export function buildTaskJobEnvelope(source: TaskJobEnvelopeSource): TaskJobEnvelope {
  const type = requireTaskType(source.type)
  const payload = parsePayload(source.payload)
  const locale = resolveTaskLocaleFromBody(payload)
  if (!locale) {
    throw new Error('task locale is missing')
  }

  const data: TaskJobData = {
    taskId: source.id,
    parentTaskId: source.parentTaskId,
    type,
    locale,
    projectId: source.projectId,
    episodeId: source.episodeId,
    targetType: source.targetType,
    targetId: source.targetId,
    payload,
    batchKey: source.batchKey,
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

  return {
    data,
    priority: source.priority,
  }
}
