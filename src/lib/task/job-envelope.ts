import { resolveTaskLocaleFromBody } from './resolve-locale'
import {
  TASK_TYPE,
  type TaskBillingInfo,
  type TaskJobData,
  type TaskJobEnvelope,
  type TaskType,
} from './types'

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
  if (!Object.values(TASK_TYPE).includes(value as TaskType)) {
    throw new Error(`invalid task type: ${value}`)
  }
  return value as TaskType
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('task payload must be an object or null')
  }
  return value as Record<string, unknown>
}

function isBillingApiType(value: unknown): boolean {
  return value === 'text'
    || value === 'image'
    || value === 'video'
    || value === 'music'
    || value === 'sound_effect'
}

function isBillingUnit(value: unknown): boolean {
  return value === 'token'
    || value === 'image'
    || value === 'video'
    || value === 'second'
    || value === 'call'
}

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
      && isBillingApiType(record.apiType)
      && typeof record.model === 'string'
      && record.model.trim().length > 0
      && Number.isFinite(record.quantity as number)
      && (record.quantity as number) > 0
      && isBillingUnit(record.unit)
      && Number.isFinite(record.maxFrozenCost as number)
      && (record.maxFrozenCost as number) >= 0
      && typeof record.action === 'string'
      && record.action.trim().length > 0
    if (!valid) {
      throw new Error('billable task billingInfo does not match the durable Task contract')
    }
  }
  return record as TaskBillingInfo
}

function readTraceRequestId(
  payload: Record<string, unknown>,
  operationRequestId: string | null,
): string | null {
  const meta = payload.meta as { trace?: { requestId?: unknown } | null } | null | undefined
  const requestId = meta?.trace?.requestId
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
