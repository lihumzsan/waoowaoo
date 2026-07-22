import { roundMoney } from '@/lib/billing/money'
import type { BillingTransactionTargetView } from './transaction-target-helpers'

const GROUPABLE_TRANSACTION_TYPES = new Set(['consume', 'shadow_consume'])

const BILLING_SPEC_KEYS = [
  'unit',
  'model',
  'apiType',
  'resolution',
  'size',
  'aspectRatio',
  'quality',
  'duration',
  'generateAudio',
  'generationMode',
  'actualModels',
] as const

const SUM_META_KEYS = [
  'quantity',
  'chargedCost',
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
] as const

type BillingSpecKey = typeof BILLING_SPEC_KEYS[number]
type SumMetaKey = typeof SUM_META_KEYS[number]

export type BillingTransactionDisplayRow = {
  id: string
  userId: string
  type: string
  amount: number
  balanceAfter: number
  description: string | null
  relatedId: string | null
  freezeId: string | null
  operatorId: string | null
  externalOrderId: string | null
  idempotencyKey: string | null
  projectId: string | null
  episodeId: string | null
  taskType: string | null
  billingMeta: Record<string, unknown> | null
  createdAt: Date
  action: string | null
  projectName: string | null
  episodeNumber: number | null
  episodeName: string | null
  target: BillingTransactionTargetView | null
  operationId: string | null
  operationRequestId: string | null
  transactionCount?: number
}

type AggregationEntry =
  | { kind: 'single'; row: BillingTransactionDisplayRow }
  | { kind: 'group'; key: string }

const GROUP_TARGET_LABEL_BY_TYPE: Record<string, string> = {
  CharacterAppearance: 'transactionTargets.characterAppearanceGroup',
  LocationImage: 'transactionTargets.locationImageGroup',
  CreativeResource: 'transactionTargets.creativeResourceGroup',
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalizeSignatureValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSignatureValue(item))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalizeSignatureValue(record[key])
        return normalized
      }, {})
  }

  return value ?? null
}

function billingSpecSignature(meta: Record<string, unknown> | null): string {
  const spec = BILLING_SPEC_KEYS.reduce<Record<BillingSpecKey, unknown>>((result, key) => {
    result[key] = normalizeSignatureValue(meta?.[key])
    return result
  }, {
    unit: null,
    model: null,
    apiType: null,
    resolution: null,
    size: null,
    aspectRatio: null,
    quality: null,
    duration: null,
    generateAudio: null,
    generationMode: null,
    actualModels: null,
  })

  return JSON.stringify(spec)
}

function createAggregationKey(row: BillingTransactionDisplayRow): string | null {
  if (!GROUPABLE_TRANSACTION_TYPES.has(row.type)) return null
  if (!row.operationRequestId || !row.operationId) return null

  return JSON.stringify([
    row.operationRequestId,
    row.operationId,
    row.type,
    row.action,
    row.projectId,
    row.episodeId,
    row.target?.targetType ?? null,
    billingSpecSignature(row.billingMeta),
  ])
}

function sumMetaField(rows: BillingTransactionDisplayRow[], key: SumMetaKey): number | null {
  let total = 0
  for (const row of rows) {
    const value = readNumber(row.billingMeta?.[key])
    if (value === null) return null
    total += value
  }
  return roundMoney(total)
}

function aggregateBillingMeta(rows: BillingTransactionDisplayRow[]): Record<string, unknown> | null {
  const firstMeta = rows[0]?.billingMeta
  if (!firstMeta) return null

  const meta: Record<string, unknown> = { ...firstMeta }
  for (const key of SUM_META_KEYS) {
    const summed = sumMetaField(rows, key)
    if (summed !== null) meta[key] = summed
  }

  if (meta.unit === 'second') {
    const duration = sumMetaField(rows, 'quantity')
    if (duration !== null) meta.duration = duration
  }

  return meta
}

function aggregateBalanceAfter(rows: BillingTransactionDisplayRow[]): number {
  const first = rows[0]
  if (!first) {
    throw new Error('Cannot aggregate balance for empty transaction rows')
  }

  if (rows.every((row) => row.amount <= 0)) {
    return Math.min(...rows.map((row) => row.balanceAfter))
  }

  if (rows.every((row) => row.amount >= 0)) {
    return Math.max(...rows.map((row) => row.balanceAfter))
  }

  return first.balanceAfter
}

function latestDate(rows: BillingTransactionDisplayRow[]): Date {
  const first = rows[0]
  if (!first) {
    throw new Error('Cannot aggregate date for empty transaction rows')
  }

  return rows.reduce((latest, row) => (
    row.createdAt.getTime() > latest.getTime() ? row.createdAt : latest
  ), first.createdAt)
}

function aggregateTarget(rows: BillingTransactionDisplayRow[]): BillingTransactionTargetView | null {
  const firstTarget = rows[0]?.target ?? null
  if (!firstTarget || rows.length < 2) return firstTarget

  const sameTargetType = rows.every((row) => row.target?.targetType === firstTarget.targetType)
  if (!sameTargetType) return firstTarget

  return {
    targetType: firstTarget.targetType,
    targetId: `group:${firstTarget.targetType}`,
    labelKey: GROUP_TARGET_LABEL_BY_TYPE[firstTarget.targetType] ?? 'transactionTargets.taskGroup',
    labelParams: { count: rows.length },
  }
}

function aggregateRows(rows: BillingTransactionDisplayRow[]): BillingTransactionDisplayRow {
  const first = rows[0]
  if (!first) {
    throw new Error('Cannot aggregate empty transaction rows')
  }

  return {
    ...first,
    id: `group:${first.operationRequestId}:${first.operationId}:${first.id}`,
    amount: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)),
    balanceAfter: aggregateBalanceAfter(rows),
    createdAt: latestDate(rows),
    relatedId: null,
    freezeId: null,
    operatorId: null,
    externalOrderId: null,
    idempotencyKey: null,
    billingMeta: aggregateBillingMeta(rows),
    target: aggregateTarget(rows),
    transactionCount: rows.length,
  }
}

export function aggregateBillingTransactionRows(
  rows: BillingTransactionDisplayRow[],
): BillingTransactionDisplayRow[] {
  const entries: AggregationEntry[] = []
  const groups = new Map<string, BillingTransactionDisplayRow[]>()

  for (const row of rows) {
    const key = createAggregationKey(row)
    if (!key) {
      entries.push({ kind: 'single', row })
      continue
    }

    const existing = groups.get(key)
    if (existing) {
      existing.push(row)
      continue
    }

    groups.set(key, [row])
    entries.push({ kind: 'group', key })
  }

  return entries.map((entry) => {
    if (entry.kind === 'single') return entry.row

    const groupedRows = groups.get(entry.key)
    if (!groupedRows) {
      throw new Error(`Missing billing transaction aggregation group: ${entry.key}`)
    }
    const firstRow = groupedRows[0]
    if (!firstRow) {
      throw new Error(`Empty billing transaction aggregation group: ${entry.key}`)
    }
    return groupedRows.length > 1 ? aggregateRows(groupedRows) : firstRow
  })
}
