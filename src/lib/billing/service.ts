import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { logError as _ulogError } from '@/lib/logging/core'
import { getLogContext } from '@/lib/logging/context'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import {
  calcImage,
  calcMusic,
  calcText,
  calcVideo,
  calcVideoByTokens,
} from './cost'
import {
  confirmChargeWithRecord,
  freezeBalance,
  getBalance,
  getFreezeByIdempotencyKey,
  increasePendingFreezeAmount,
  recordShadowUsage,
  rollbackFreeze,
} from './ledger'
import type { ApiType, UsageUnit } from './cost'
import { getBillingMode } from './mode'
import { BillingOperationError, InsufficientBalanceError } from './errors'
import { roundMoney } from './money'
import { withTextUsageCollection, type TextUsageEntry } from './runtime-usage'
import type {
  BillingRecordParams,
  TaskBillingInfo,
} from './types'
import { BUILTIN_PRICING_VERSION } from '@/lib/ai-registry/pricing-resolution'
import { assertPositiveChargeForBillingMode } from './billing-policy'

type CostInput = {
  apiType: ApiType
  model: string
  quantity: number
  unit: UsageUnit
  metadata?: Record<string, unknown>
  quotedCost?: number
  maxCost?: number
}

type SyncBillingParams<T> = {
  userId: string
  projectId: string
  action: string
  apiType: ApiType
  model: string
  quantity: number
  unit: UsageUnit
  metadata?: Record<string, unknown>
  quotedCost?: number
  maxCost?: number
  extractActualQuantity?: (result: T) => number | null | undefined
}

type ResolvedActual = {
  actualCost: number
  actualQuantity: number
  metadata?: Record<string, unknown>
}

type UsageByModel = Record<string, { inputTokens: number; outputTokens: number; cost: number }>

const MONEY_SCALE = 6
const MONEY_EPSILON = 1e-9

function normalizeMoney(value: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return roundMoney(Math.max(0, numeric), MONEY_SCALE)
}

function asNumber(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

function readPayloadNumber(
  payload: Record<string, unknown> | null,
  fields: readonly string[],
): number | null {
  if (!payload) return null
  for (const field of fields) {
    const value = asNumber(payload[field])
    if (value !== null) return value
  }
  return null
}

function resolveCost(input: CostInput) {
  const asMoney = (value: number) => normalizeMoney(value)

  if (typeof input.maxCost === 'number' && input.maxCost >= 0) {
    return asMoney(input.maxCost)
  }

  if (typeof input.quotedCost === 'number' && input.quotedCost >= 0) {
    return asMoney(input.quotedCost)
  }

  switch (input.apiType) {
    case 'text': {
      const inputTokens = Number(input.metadata?.inputTokens ?? Math.floor(input.quantity * 0.7))
      const outputTokens = Number(input.metadata?.outputTokens ?? Math.max(input.quantity - inputTokens, 0))
      return asMoney(calcText(input.model, Math.max(inputTokens, 0), Math.max(outputTokens, 0)))
    }
    case 'image':
      return asMoney(calcImage(input.model, input.quantity, input.metadata))
    case 'video': {
      const resolution = typeof input.metadata?.resolution === 'string' ? input.metadata.resolution : '720p'
      return asMoney(calcVideo(input.model, resolution, input.quantity, input.metadata))
    }
    case 'music':
      return asMoney(calcMusic(input.model, input.quantity, input.metadata))
    default:
      throw new BillingOperationError('BILLING_INVALID_API_TYPE', `Unsupported billing apiType: ${String(input.apiType)}`, {
        apiType: input.apiType,
        model: input.model,
      })
  }
}

function resolveTextCostFromUsage(
  usage: TextUsageEntry[],
): ResolvedActual | null {
  if (!Array.isArray(usage) || usage.length === 0) return null

  let inputTokens = 0
  let outputTokens = 0
  let cost = 0
  const byModel: UsageByModel = {}

  for (const item of usage) {
    const inTokens = Math.max(0, Math.floor(Number(item.inputTokens || 0)))
    const outTokens = Math.max(0, Math.floor(Number(item.outputTokens || 0)))
    const model = item.model || 'unknown'
    const hasBillableTokens = inTokens > 0 || outTokens > 0
    const itemCost = hasBillableTokens ? normalizeMoney(calcText(model, inTokens, outTokens)) : 0

    inputTokens += inTokens
    outputTokens += outTokens
    cost += itemCost

    if (!byModel[model]) {
      byModel[model] = { inputTokens: 0, outputTokens: 0, cost: 0 }
    }
    byModel[model].inputTokens += inTokens
    byModel[model].outputTokens += outTokens
    byModel[model].cost += itemCost
  }

  return {
    actualCost: normalizeMoney(cost),
    actualQuantity: inputTokens + outputTokens,
    metadata: {
      actualInputTokens: inputTokens,
      actualOutputTokens: outputTokens,
      usageByModel: byModel,
    },
  }
}

function resolveRecordModel(defaultModel: string, metadata?: Record<string, unknown>) {
  const usageByModelValue = metadata?.usageByModel
  if (!usageByModelValue || typeof usageByModelValue !== 'object' || Array.isArray(usageByModelValue)) {
    return {
      model: defaultModel,
      actualModels: [] as string[],
    }
  }
  const actualModels = Object.keys(usageByModelValue as UsageByModel).filter((item) => typeof item === 'string' && item.trim())
  if (actualModels.length === 0) {
    return {
      model: defaultModel,
      actualModels,
    }
  }
  if (actualModels.length === 1) {
    return {
      model: actualModels[0],
      actualModels,
    }
  }
  return {
    model: 'multi-model',
    actualModels,
  }
}

async function executeWithUsage<T>(
  apiType: ApiType,
  execute: () => Promise<T>,
): Promise<{ result: T; textUsage: TextUsageEntry[] }> {
  if (apiType !== 'text') {
    return {
      result: await execute(),
      textUsage: [],
    }
  }
  return await withTextUsageCollection(execute)
}

function clampChargedCost(actualCost: number, freezeCost: number) {
  const normalizedActual = normalizeMoney(actualCost)
  const normalizedFreeze = normalizeMoney(freezeCost)
  if (normalizedActual <= normalizedFreeze + MONEY_EPSILON) {
    return normalizedActual
  }
  _ulogError('[Billing] actual cost exceeds frozen max, overage freeze required', {
    actualCost: normalizedActual,
    frozenCost: normalizedFreeze,
    requiredOverage: normalizeMoney(normalizedActual - normalizedFreeze),
  })
  return normalizedActual
}

async function ensureFreezeCoverage(params: {
  freezeId: string
  userId: string
  actualCost: number
  quotedCost: number
}): Promise<number> {
  const normalizedQuoted = normalizeMoney(params.quotedCost)
  const chargedCost = clampChargedCost(params.actualCost, normalizedQuoted)
  if (chargedCost <= normalizedQuoted + MONEY_EPSILON) {
    return chargedCost
  }

  const overage = normalizeMoney(chargedCost - normalizedQuoted)
  if (overage <= MONEY_EPSILON) {
    return chargedCost
  }
  const expanded = await increasePendingFreezeAmount(params.freezeId, overage)
  if (expanded) {
    return chargedCost
  }

  await rollbackFreeze(params.freezeId)
  const balance = await getBalance(params.userId)
  throw new InsufficientBalanceError(chargedCost, balance.balance)
}

function resolveActualForSync<T>(
  params: SyncBillingParams<T>,
  result: T,
  textUsage: TextUsageEntry[],
  quotedCost: number,
): ResolvedActual {
  const textResolved = resolveTextCostFromUsage(textUsage)
  if (params.apiType === 'text' && textResolved) {
    if (textResolved.actualQuantity > 0) {
      return textResolved
    }
    return {
      actualCost: quotedCost,
      actualQuantity: params.quantity,
      metadata: {
        ...(textResolved.metadata || {}),
      },
    }
  }

  if (params.extractActualQuantity) {
    const actualQuantity = asNumber(params.extractActualQuantity(result))
    if (actualQuantity !== null && actualQuantity >= 0) {
      return {
        actualCost: resolveCost({
          apiType: params.apiType,
          model: params.model,
          quantity: actualQuantity,
          unit: params.unit,
          metadata: params.metadata,
        }),
        actualQuantity,
      }
    }
  }

  return {
    actualCost: quotedCost,
    actualQuantity: params.quantity,
  }
}

function resolveTaskActual(
  info: Extract<TaskBillingInfo, { billable: true }>,
  quotedCost: number,
  options?: {
    result?: Record<string, unknown> | void
    textUsage?: TextUsageEntry[]
  },
): ResolvedActual {
  const textResolved = resolveTextCostFromUsage(options?.textUsage || [])
  if (info.apiType === 'text' && textResolved) {
    if (textResolved.actualQuantity > 0) {
      return textResolved
    }
    return {
      actualCost: quotedCost,
      actualQuantity: info.quantity,
      metadata: {
        ...(textResolved.metadata || {}),
      },
    }
  }

  const payload = options?.result && typeof options.result === 'object' ? options.result : null
  const actualVideoTokens = payload
    ? asNumber((payload as Record<string, unknown>).actualVideoTokens)
    : null
  if (info.apiType === 'video' && actualVideoTokens !== null && actualVideoTokens >= 0) {
    return {
      actualCost: calcVideoByTokens(info.model, actualVideoTokens, info.metadata),
      actualQuantity: actualVideoTokens,
      metadata: {
        actualVideoTokens,
      },
    }
  }
  const actualQuantity = readPayloadNumber(payload, ['actualQuantity', 'actualCharacters'])

  if (actualQuantity !== null && actualQuantity >= 0) {
    return {
      actualCost: resolveCost({
        apiType: info.apiType,
        model: info.model,
        quantity: actualQuantity,
        unit: info.unit,
        metadata: info.metadata,
      }),
      actualQuantity,
    }
  }

  const actualDurationSeconds = readPayloadNumber(payload, ['actualSeconds', 'actualDurationSeconds'])
  if (actualDurationSeconds !== null && actualDurationSeconds >= 0) {
    if (info.apiType === 'video') {
      const metadata = {
        ...(info.metadata || {}),
        duration: actualDurationSeconds,
        actualDurationSeconds,
      }
      return {
        actualCost: resolveCost({
          apiType: info.apiType,
          model: info.model,
          quantity: info.quantity,
          unit: info.unit,
          metadata,
        }),
        actualQuantity: info.quantity,
        metadata,
      }
    }

    if (info.apiType === 'music') {
      return {
        actualCost: resolveCost({
          apiType: info.apiType,
          model: info.model,
          quantity: info.quantity,
          unit: info.unit,
          metadata: info.metadata,
        }),
        actualQuantity: info.quantity,
        metadata: { actualDurationSeconds },
      }
    }
  }

  return {
    actualCost: resolveCost({
      apiType: info.apiType,
      model: info.model,
      quantity: info.quantity,
      unit: info.unit,
      metadata: info.metadata,
      quotedCost: info.maxFrozenCost,
    }),
    actualQuantity: info.quantity,
  }
}

function buildSyncBillingKey<T>(params: SyncBillingParams<T>, recordParams: BillingRecordParams) {
  if (recordParams.billingKey) return recordParams.billingKey

  const metadataFingerprint = JSON.stringify({
    ...(recordParams.metadata || {}),
    ...(params.metadata || {}),
  })
  const requestId =
    recordParams.requestId
    || (typeof recordParams.metadata?.requestId === 'string' ? recordParams.metadata.requestId : null)
    || getLogContext().requestId

  if (requestId) {
    const digest = createHash('sha1')
      .update(`${params.userId}:${params.projectId}:${params.action}:${params.apiType}:${params.model}:${params.quantity}:${metadataFingerprint}:${requestId}`)
      .digest('hex')
      .slice(0, 16)
    return `sync_${requestId}_${digest}`
  }

  return `sync_${randomUUID()}`
}

async function withSyncBillingCore<T>(
  params: SyncBillingParams<T>,
  recordParams: BillingRecordParams,
  execute: () => Promise<T>,
): Promise<T> {
  const pricingVersion = BUILTIN_PRICING_VERSION
  const pricingSelections = params.metadata || {}
  const mode = await getBillingMode()
  if (mode === 'OFF') {
    return await execute()
  }

  const quotedCost = resolveCost({
    apiType: params.apiType,
    model: params.model,
    quantity: params.quantity,
    unit: params.unit,
    metadata: params.metadata,
    quotedCost: params.quotedCost,
    maxCost: params.maxCost,
  })

  if (quotedCost <= 0) {
    assertPositiveChargeForBillingMode(mode, quotedCost, {
      taskType: params.action,
      apiType: params.apiType,
      model: params.model,
    })
    return await execute()
  }

  if (mode === 'SHADOW') {
    const { result, textUsage } = await executeWithUsage(params.apiType, execute)
    const actual = resolveActualForSync(params, result, textUsage, quotedCost)
    await recordShadowUsage(params.userId, {
      projectId: params.projectId,
      taskType: params.action || null,
      action: params.action,
      apiType: params.apiType,
      model: params.model,
      quantity: actual.actualQuantity,
      unit: params.unit,
      cost: actual.actualCost,
      metadata: {
        ...(recordParams.metadata || {}),
        ...(params.metadata || {}),
        ...(actual.metadata || {}),
        mode: 'SHADOW',
        quotedCost,
        pricingVersion,
        pricingSelections,
      },
    })
    return result
  }

  const billingKey = buildSyncBillingKey(params, recordParams)
  const requestId = recordParams.requestId || getLogContext().requestId || undefined
  const existingFreeze = await getFreezeByIdempotencyKey(billingKey)
  if (existingFreeze) {
    if (existingFreeze.status === 'confirmed') {
      throw new BillingOperationError(
        'BILLING_IDEMPOTENT_ALREADY_CONFIRMED',
        'duplicate billing request already confirmed',
        { billingKey, freezeId: existingFreeze.id },
      )
    }
    if (existingFreeze.status === 'pending') {
      throw new BillingOperationError(
        'BILLING_IDEMPOTENT_IN_PROGRESS',
        'duplicate billing request is already in progress',
        { billingKey, freezeId: existingFreeze.id },
      )
    }
    if (existingFreeze.status === 'rolled_back') {
      throw new BillingOperationError(
        'BILLING_IDEMPOTENT_ROLLED_BACK',
        'duplicate billing request was already rolled back',
        { billingKey, freezeId: existingFreeze.id },
      )
    }
  }

  const freezeId = await freezeBalance(params.userId, quotedCost, {
    source: 'sync',
    requestId,
    idempotencyKey: billingKey,
    metadata: {
      projectId: params.projectId,
      action: params.action,
      apiType: params.apiType,
      model: params.model,
      unit: params.unit,
      quantity: params.quantity,
      billingKey,
      requestId,
      ...(recordParams.metadata || {}),
      ...(params.metadata || {}),
      pricingVersion,
      pricingSelections,
    },
  })
  if (!freezeId) {
    const balance = await getBalance(params.userId)
    throw new InsufficientBalanceError(quotedCost, balance.balance)
  }

  try {
    const { result, textUsage } = await executeWithUsage(params.apiType, execute)
    const actual = resolveActualForSync(params, result, textUsage, quotedCost)
    const recordModel = resolveRecordModel(params.model, actual.metadata)
    const chargedCost = await ensureFreezeCoverage({
      freezeId,
      userId: params.userId,
      actualCost: actual.actualCost,
      quotedCost,
    })
    await confirmChargeWithRecord(
      freezeId,
      {
        projectId: params.projectId,
        action: params.action,
        apiType: params.apiType,
        model: recordModel.model,
        quantity: actual.actualQuantity,
        unit: params.unit,
        metadata: {
          ...(recordParams.metadata || {}),
          ...(params.metadata || {}),
          ...(actual.metadata || {}),
          mode: 'ENFORCE',
          quotedCost,
          actualCost: actual.actualCost,
          chargedCost,
          pricingVersion,
          pricingSelections,
          billingKey,
          requestId,
          ...(recordModel.actualModels.length > 0 ? { actualModels: recordModel.actualModels } : {}),
        },
      },
      { chargedAmount: chargedCost },
    )
    return result
  } catch (error) {
    await rollbackFreeze(freezeId)
    if (error instanceof BillingOperationError) {
      throw new BillingOperationError(error.code, error.message, {
        ...(error.details || {}),
        billingKey,
        pricingVersion,
      }, error)
    }
    throw error
  }
}

export async function withTextBilling<T>(
  userId: string,
  model: string,
  maxInputTokens: number,
  recordParams: BillingRecordParams,
  generateFn: () => Promise<T>,
): Promise<T> {
  const mode = await getBillingMode()
  if (mode === 'OFF') {
    return await generateFn()
  }

  const quotedCost = calcText(model, maxInputTokens, 0)
  return await withSyncBillingCore(
    {
      userId,
      projectId: recordParams.projectId,
      action: recordParams.action,
      apiType: 'text',
      model,
      quantity: maxInputTokens,
      unit: 'token',
      metadata: {
        ...recordParams.metadata,
        maxInputTokens,
      },
      maxCost: quotedCost,
    },
    recordParams,
    generateFn,
  )
}

export async function withImageBilling<T>(
  userId: string,
  model: string,
  count: number,
  recordParams: BillingRecordParams,
  generateFn: () => Promise<T>,
): Promise<T> {
  return await withSyncBillingCore(
    {
      userId,
      projectId: recordParams.projectId,
      action: recordParams.action,
      apiType: 'image',
      model,
      quantity: count,
      unit: 'image',
      metadata: recordParams.metadata,
    },
    recordParams,
    generateFn,
  )
}

export async function withVideoBilling<T>(
  userId: string,
  model: string,
  resolution: string,
  maxCount: number,
  recordParams: BillingRecordParams,
  generateFn: () => Promise<T>,
): Promise<T> {
  return await withSyncBillingCore(
    {
      userId,
      projectId: recordParams.projectId,
      action: recordParams.action,
      apiType: 'video',
      model,
      quantity: maxCount,
      unit: 'video',
      metadata: { ...recordParams.metadata, resolution },
    },
    recordParams,
    generateFn,
  )
}

export function handleBillingError(error: unknown): NextResponse | null {
  if (error instanceof InsufficientBalanceError) {
    return NextResponse.json(
      {
        error: error.message,
        code: 'INSUFFICIENT_BALANCE',
        required: error.required,
        available: error.available,
      },
      { status: 402 },
    )
  }
  return null
}

export async function prepareTaskBilling(task: {
  id: string
  userId: string
  projectId: string
  billingInfo: TaskBillingInfo | { billable: false } | null
}) {
  const info = task.billingInfo
  if (!info || !info.billable) return info

  const mode = await getBillingMode()
  const next: TaskBillingInfo = {
    ...info,
    modeSnapshot: mode,
    billingKey: info.billingKey || task.id,
    pricingVersion: info.pricingVersion || BUILTIN_PRICING_VERSION,
  }

  if (mode === 'OFF') {
    next.status = 'skipped'
    return next
  }

  const quotedCost = resolveCost({
    apiType: info.apiType,
    model: info.model,
    quantity: info.quantity,
    unit: info.unit,
    metadata: info.metadata,
    quotedCost: info.maxFrozenCost,
  })

  if (quotedCost <= 0) {
    assertPositiveChargeForBillingMode(mode, quotedCost, next)
    next.status = 'skipped'
    return next
  }

  if (mode === 'SHADOW') {
    next.status = 'quoted'
    next.maxFrozenCost = quotedCost
    return next
  }

  const freezeId = await freezeBalance(task.userId, quotedCost, {
    source: 'task',
    taskId: task.id,
    idempotencyKey: info.billingKey || task.id,
    metadata: {
      taskType: info.taskType,
      action: info.action,
      apiType: info.apiType,
      model: info.model,
      quantity: info.quantity,
      unit: info.unit,
      billingKey: info.billingKey || task.id,
      pricingVersion: info.pricingVersion || BUILTIN_PRICING_VERSION,
      pricingSelections: info.metadata || {},
      ...(info.metadata || {}),
    },
  })
  if (!freezeId) {
    const balance = await getBalance(task.userId)
    throw new InsufficientBalanceError(quotedCost, balance.balance)
  }

  next.status = 'frozen'
  next.freezeId = freezeId
  next.maxFrozenCost = quotedCost
  return next
}

export async function settleTaskBilling(task: {
  id: string
  projectId: string
  episodeId?: string | null
  userId: string
  billingInfo: TaskBillingInfo | { billable: false } | null
}, options?: {
  result?: Record<string, unknown> | void
  textUsage?: TextUsageEntry[]
}) {
  const info = task.billingInfo
  if (!info || !info.billable) return info

  const mode = info.modeSnapshot || await getBillingMode()
  const noChargeStatus = info.status === 'skipped' ? 'skipped' : 'settled'
  if (mode === 'OFF') {
    return {
      ...info,
      modeSnapshot: mode,
      status: noChargeStatus,
      chargedCost: 0,
    } satisfies TaskBillingInfo
  }

  const quotedCost = resolveCost({
    apiType: info.apiType,
    model: info.model,
    quantity: info.quantity,
    unit: info.unit,
    metadata: info.metadata,
    quotedCost: info.maxFrozenCost,
  })

  if (mode === 'SHADOW' && quotedCost <= 0) {
    return {
      ...info,
      modeSnapshot: mode,
      status: noChargeStatus,
      chargedCost: 0,
    } satisfies TaskBillingInfo
  }

  const actual = resolveTaskActual(info, quotedCost, options)

  if (mode === 'SHADOW') {
    await recordShadowUsage(task.userId, {
      projectId: task.projectId,
      episodeId: typeof task.episodeId === 'string' ? task.episodeId : null,
      taskType: info.taskType || null,
      action: info.action,
      apiType: info.apiType,
      model: info.model,
      quantity: actual.actualQuantity,
      unit: info.unit,
      cost: actual.actualCost,
      metadata: {
        ...(info.metadata || {}),
        ...(actual.metadata || {}),
        mode: 'SHADOW',
        taskId: task.id,
        taskType: info.taskType,
        quotedCost,
        pricingVersion: info.pricingVersion || BUILTIN_PRICING_VERSION,
        pricingSelections: info.metadata || {},
      },
    })
    return {
      ...info,
      modeSnapshot: mode,
      status: info.status === 'skipped' ? 'skipped' : 'settled',
      chargedCost: 0,
    } satisfies TaskBillingInfo
  }

  if (mode !== 'ENFORCE') {
    return {
      ...info,
      modeSnapshot: mode,
      status: info.status === 'skipped' ? 'skipped' : 'settled',
      chargedCost: 0,
    } satisfies TaskBillingInfo
  }

  if (!info.freezeId) {
    return {
      ...info,
      status: 'failed',
    } satisfies TaskBillingInfo
  }

  const chargedCost = await ensureFreezeCoverage({
    freezeId: info.freezeId,
    userId: task.userId,
    actualCost: actual.actualCost,
    quotedCost,
  })
  const recordModel = resolveRecordModel(info.model, actual.metadata)
  try {
    await confirmChargeWithRecord(
      info.freezeId,
      {
        projectId: task.projectId,
        action: info.action,
        apiType: info.apiType,
        model: recordModel.model,
        quantity: actual.actualQuantity,
        unit: info.unit,
        metadata: {
          ...(info.metadata || {}),
          ...(actual.metadata || {}),
          billingKey: info.billingKey || task.id,
          source: 'task',
          taskType: info.taskType,
          taskId: task.id,
          mode: 'ENFORCE',
          quotedCost,
          actualCost: actual.actualCost,
          chargedCost,
          pricingVersion: info.pricingVersion || BUILTIN_PRICING_VERSION,
          pricingSelections: info.metadata || {},
          ...(recordModel.actualModels.length > 0 ? { actualModels: recordModel.actualModels } : {}),
        },
      },
      { chargedAmount: chargedCost },
    )
  } catch (error) {
    const rolledBack = (await rollbackTaskBilling({
      id: task.id,
      billingInfo: info,
    })) as TaskBillingInfo
    if (rolledBack.billable && rolledBack.status !== 'rolled_back') {
      throw new BillingOperationError('BILLING_CONFIRM_FAILED', 'confirm task charge failed; billing rollback failed', {
        taskId: task.id,
        freezeId: info.freezeId,
      }, error)
    }
    if (error instanceof BillingOperationError) {
      throw new BillingOperationError(error.code, error.message, {
        ...(error.details || {}),
        taskId: task.id,
        freezeId: info.freezeId,
      }, error)
    }
    throw error
  }

  return {
    ...info,
    status: 'settled',
    chargedCost,
  } satisfies TaskBillingInfo
}

export async function rollbackTaskBilling(task: {
  id: string
  billingInfo: TaskBillingInfo | { billable: false } | null
}) {
  const info = task.billingInfo
  if (!info || !info.billable) return info
  if (!info.freezeId) return info
  if (info.modeSnapshot !== 'ENFORCE') return info

  try {
    await rollbackFreeze(info.freezeId)
    return {
      ...info,
      status: 'rolled_back',
    } satisfies TaskBillingInfo
  } catch (error) {
    _ulogError('[Billing] rollback task freeze failed:', error)
    return {
      ...info,
      status: 'failed',
    } satisfies TaskBillingInfo
  }
}
ensureAiCatalogsRegistered()
