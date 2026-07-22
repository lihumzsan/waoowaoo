import { TASK_TYPE, type TaskBillingInfo, type TaskType } from './types'

const TASK_TYPES: ReadonlySet<string> = new Set(Object.values(TASK_TYPE))
const API_TYPES: ReadonlySet<string> = new Set(['text', 'image', 'video', 'music', 'voice'])
const UNITS: ReadonlySet<string> = new Set(['token', 'image', 'video', 'second', 'call', 'character'])
const MODES: ReadonlySet<string> = new Set(['OFF', 'SHADOW', 'ENFORCE'])
const STATUSES: ReadonlySet<string> = new Set([
  'skipped', 'quoted', 'frozen', 'settled', 'rolled_back', 'failed',
])

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

export function parseTaskBillingInfo(
  value: unknown,
  expectedTaskType?: TaskType,
): TaskBillingInfo | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TASK_BILLING_INFO_INVALID:object_required')
  }
  const record = value as Record<string, unknown>
  if (record.billable === false) {
    if (record.source !== undefined && record.source !== 'task') {
      throw new Error('TASK_BILLING_INFO_INVALID:source')
    }
    if (record.status !== undefined && record.status !== 'skipped') {
      throw new Error('TASK_BILLING_INFO_INVALID:status')
    }
    return record as TaskBillingInfo
  }
  if (record.billable !== true) throw new Error('TASK_BILLING_INFO_INVALID:billable')

  const metadataValid = record.metadata === undefined
    || (typeof record.metadata === 'object' && record.metadata !== null && !Array.isArray(record.metadata))
  const valid = record.source === 'task'
    && typeof record.taskType === 'string'
    && TASK_TYPES.has(record.taskType)
    && (expectedTaskType === undefined || record.taskType === expectedTaskType)
    && typeof record.apiType === 'string'
    && API_TYPES.has(record.apiType)
    && typeof record.model === 'string'
    && record.model.trim().length > 0
    && typeof record.quantity === 'number'
    && Number.isFinite(record.quantity)
    && record.quantity > 0
    && typeof record.unit === 'string'
    && UNITS.has(record.unit)
    && typeof record.maxFrozenCost === 'number'
    && Number.isFinite(record.maxFrozenCost)
    && record.maxFrozenCost >= 0
    && typeof record.action === 'string'
    && record.action.trim().length > 0
    && isOptionalString(record.pricingVersion)
    && isOptionalString(record.billingKey)
    && isOptionalString(record.freezeId)
    && (record.modeSnapshot === undefined || record.modeSnapshot === null
      || (typeof record.modeSnapshot === 'string' && MODES.has(record.modeSnapshot)))
    && (record.status === undefined || (typeof record.status === 'string' && STATUSES.has(record.status)))
    && isOptionalFiniteNumber(record.chargedCost)
    && metadataValid
  if (!valid) throw new Error('TASK_BILLING_INFO_INVALID:contract')
  return record as TaskBillingInfo
}
