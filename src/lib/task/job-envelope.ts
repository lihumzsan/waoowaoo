import { resolveTaskLocaleFromBody } from './resolve-locale'
import {
  TASK_TYPE,
  type TaskBillingInfo,
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
  operationConfirmed: boolean | null
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

const BILLING_API_TYPES: ReadonlySet<string> = new Set([
  'text',
  'image',
  'video',
  'music',
  'sound_effect',
])
const BILLING_UNITS: ReadonlySet<string> = new Set([
  'token',
  'image',
  'video',
  'second',
  'call',
])

function parseBillingInfo(value: unknown, taskType: TaskType): TaskBillingInfo | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('task billingInfo must be an object or null')
  }
  const record = value as Record<string, unknown>
  if (record.billable !== true && record.billable !== false) {
    throw new Error('task billingInfo.billable must be a boolean')
  }
  if (record.billable === true) {
    const valid = record.source === 'task'
      && record.taskType === taskType
      && typeof record.apiType === 'string'
      && BILLING_API_TYPES.has(record.apiType)
      && typeof record.model === 'string'
      && record.model.trim().length > 0
      && typeof record.quantity === 'number'
      && Number.isFinite(record.quantity)
      && record.quantity > 0
      && typeof record.unit === 'string'
      && BILLING_UNITS.has(record.unit)
      && typeof record.maxFrozenCost === 'number'
      && Number.isFinite(record.maxFrozenCost)
      && record.maxFrozenCost >= 0
      && typeof record.action === 'string'
      && record.action.trim().length > 0
    if (!valid) {
      throw new Error('billable task billingInfo does not match the durable Task contract')
    }
  }
  return record as TaskBillingInfo
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
    billingInfo: parseBillingInfo(source.billingInfo, type),
    userId: source.userId,
    operationId: source.operationId,
    operationSource: source.operationSource,
    operationConfirmed: source.operationConfirmed,
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
