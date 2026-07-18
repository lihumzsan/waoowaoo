import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordUsageCostOnly, buildBillingMeta } from './reporting'
import type { ApiType, UsageUnit } from './cost'
import { BillingOperationError } from './errors'
import { roundMoney, toMoneyNumber, type MoneyValue } from './money'

type LedgerRecordParams = {
  projectId: string
  action: string
  apiType: ApiType
  model: string
  quantity: number
  unit: UsageUnit
  metadata?: Record<string, unknown>
  episodeId?: string | null
  taskType?: string | null
}

export type FreezeSnapshot = {
  id: string
  userId: string
  amount: number
  status: string
}

export type FreezeBalanceResult =
  | {
      status: 'frozen' | 'already_frozen'
      freezeId: string
    }
  | {
      status: 'conflict'
      freezeId: string
      freezeStatus: string
      frozenAmount: number
    }
  | {
      status: 'insufficient_balance'
      required: number
      available: number
    }

type BalanceSnapshot = {
  id: string
  userId: string
  balance: number
  frozenAmount: number
  totalSpent: number
  createdAt: Date
  updatedAt: Date
}

const MONEY_SCALE = 6
const MONEY_EPSILON = 1e-9

function normalizeMoney(value: number): number {
  return roundMoney(value, MONEY_SCALE)
}

function toBalanceSnapshot(balance: {
  id: string
  userId: string
  balance: MoneyValue
  frozenAmount: MoneyValue
  totalSpent: MoneyValue
  createdAt: Date
  updatedAt: Date
}): BalanceSnapshot {
  return {
    id: balance.id,
    userId: balance.userId,
    balance: toMoneyNumber(balance.balance),
    frozenAmount: toMoneyNumber(balance.frozenAmount),
    totalSpent: toMoneyNumber(balance.totalSpent),
    createdAt: balance.createdAt,
    updatedAt: balance.updatedAt,
  }
}

export async function getBalance(userId: string) {
  const balance = await prisma.userBalance.findUnique({
    where: { userId },
  })

  if (!balance) {
    const created = await prisma.userBalance.create({
      data: { userId, balance: 0, frozenAmount: 0, totalSpent: 0 },
    })
    return toBalanceSnapshot(created)
  }

  return toBalanceSnapshot(balance)
}

export async function getFreezeByIdempotencyKey(idempotencyKey: string): Promise<FreezeSnapshot | null> {
  if (!idempotencyKey || !idempotencyKey.trim()) return null
  const freeze = await prisma.balanceFreeze.findUnique({
    where: { idempotencyKey },
    select: {
      id: true,
      userId: true,
      amount: true,
      status: true,
    },
  })
  if (!freeze) return null
  return {
    id: freeze.id,
    userId: freeze.userId,
    amount: toMoneyNumber(freeze.amount),
    status: freeze.status,
  }
}

export async function checkBalance(userId: string, requiredAmount: number): Promise<boolean> {
  const balance = await getBalance(userId)
  return balance.balance >= requiredAmount
}

type FreezeBalanceOptions = {
  source?: string
  taskId?: string
  requestId?: string
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

function requirePositiveFreezeAmount(amount: number): number {
  const normalizedAmount = normalizeMoney(Number(amount))
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new BillingOperationError('BILLING_INVALID_FREEZE_AMOUNT', 'freeze amount must be a positive number', {
      amount,
    })
  }
  return normalizedAmount
}

export type FreezeExpectation = {
  userId: string
  taskId: string | null
  amount: number
}

function assertFreezeExpectation(
  freeze: { id: string; userId: string; taskId: string | null; amount: Prisma.Decimal },
  expected: FreezeExpectation,
): void {
  const amount = normalizeMoney(toMoneyNumber(freeze.amount))
  const expectedAmount = normalizeMoney(expected.amount)
  if (
    freeze.userId !== expected.userId
    || freeze.taskId !== expected.taskId
    || Math.abs(amount - expectedAmount) > MONEY_EPSILON
  ) {
    throw new BillingOperationError('BILLING_FREEZE_OWNERSHIP_MISMATCH', 'freeze ownership does not match task billing snapshot', {
      freezeId: freeze.id,
      actualUserId: freeze.userId,
      expectedUserId: expected.userId,
      actualTaskId: freeze.taskId,
      expectedTaskId: expected.taskId,
      actualAmount: amount,
      expectedAmount,
    })
  }
}

export async function freezeBalanceInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  options?: FreezeBalanceOptions,
): Promise<FreezeBalanceResult> {
  const normalizedAmount = requirePositiveFreezeAmount(amount)

  if (options?.idempotencyKey) {
    const existing = await tx.balanceFreeze.findUnique({ where: { idempotencyKey: options.idempotencyKey } })
    if (existing) {
      const existingAmount = toMoneyNumber(existing.amount)
      const sameOwner = existing.userId === userId
        && existing.taskId === (options.taskId ?? null)
      if (!sameOwner) {
        throw new BillingOperationError('BILLING_FREEZE_OWNERSHIP_MISMATCH', 'idempotency key belongs to another billing owner', {
          freezeId: existing.id,
          idempotencyKey: options.idempotencyKey,
          actualUserId: existing.userId,
          expectedUserId: userId,
          actualTaskId: existing.taskId,
          expectedTaskId: options.taskId ?? null,
        })
      }
      return existing.status === 'pending'
        && Math.abs(existingAmount - normalizedAmount) <= MONEY_EPSILON
        ? { status: 'already_frozen', freezeId: existing.id }
        : {
            status: 'conflict',
            freezeId: existing.id,
            freezeStatus: existing.status,
            frozenAmount: existingAmount,
          }
    }
  }
  const existingBalance = await tx.userBalance.findUnique({ where: { userId } })
  const balance = existingBalance ?? await tx.userBalance.create({
    data: { userId, balance: 0, frozenAmount: 0, totalSpent: 0 },
  })
  const updated = await tx.userBalance.updateMany({
    where: { userId, balance: { gte: normalizedAmount } },
    data: {
      balance: { decrement: normalizedAmount },
      frozenAmount: { increment: normalizedAmount },
    },
  })
  if (updated.count === 0) {
    const latest = await tx.userBalance.findUnique({ where: { userId }, select: { balance: true } })
    return {
      status: 'insufficient_balance',
      required: normalizedAmount,
      available: latest ? toMoneyNumber(latest.balance) : toMoneyNumber(balance.balance),
    }
  }
  const freezeId = `freeze_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  await tx.balanceFreeze.create({
    data: {
      id: freezeId,
      userId,
      amount: normalizedAmount,
      status: 'pending',
      source: options?.source || 'sync',
      taskId: options?.taskId || null,
      requestId: options?.requestId || null,
      idempotencyKey: options?.idempotencyKey || null,
      metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
    },
  })
  return { status: 'frozen', freezeId }
}

export async function freezeBalance(
  userId: string,
  amount: number,
  options?: FreezeBalanceOptions,
): Promise<FreezeBalanceResult> {
  const normalizedAmount = requirePositiveFreezeAmount(amount)
  try {
    return await prisma.$transaction(async (tx) => (
      await freezeBalanceInTransaction(tx, userId, normalizedAmount, options)
    ))
  } catch (error) {
    if (
      options?.idempotencyKey
      && error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
    ) {
      const existing = await prisma.balanceFreeze.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
        select: { id: true, status: true, amount: true, userId: true, taskId: true },
      })
      if (existing?.id) {
        const existingAmount = toMoneyNumber(existing.amount)
        const sameOwner = existing.userId === userId
          && existing.taskId === (options.taskId ?? null)
        if (!sameOwner) {
          throw new BillingOperationError('BILLING_FREEZE_OWNERSHIP_MISMATCH', 'idempotency key belongs to another billing owner', {
            freezeId: existing.id,
            idempotencyKey: options.idempotencyKey,
            actualUserId: existing.userId,
            expectedUserId: userId,
            actualTaskId: existing.taskId,
            expectedTaskId: options.taskId ?? null,
          })
        }
        return existing.status === 'pending'
          && Math.abs(existingAmount - normalizedAmount) <= MONEY_EPSILON
          ? {
              status: 'already_frozen',
              freezeId: existing.id,
            }
          : {
              status: 'conflict',
              freezeId: existing.id,
              freezeStatus: existing.status,
              frozenAmount: existingAmount,
            }
      }
    }
    _ulogError('[Billing] freeze failed:', error)
    if (error instanceof BillingOperationError) throw error
    if (error instanceof Error) {
      throw new BillingOperationError('BILLING_FREEZE_FAILED', error.message, {
        userId,
        amount: normalizedAmount,
        idempotencyKey: options?.idempotencyKey ?? null,
      }, error)
    }
    throw new BillingOperationError('BILLING_FREEZE_FAILED', `freeze balance failed: ${String(error)}`, {
      userId,
      amount: normalizedAmount,
      idempotencyKey: options?.idempotencyKey ?? null,
    })
  }
}

export async function confirmChargeWithRecordInTransaction(
  tx: Prisma.TransactionClient,
  freezeId: string,
  recordParams: LedgerRecordParams,
  options: {
    chargedAmount?: number
    expected: FreezeExpectation
  },
): Promise<'settled' | 'already_settled'> {
  const freeze = await tx.balanceFreeze.findUnique({ where: { id: freezeId } })
  if (!freeze) {
    throw new BillingOperationError('BILLING_INVALID_FREEZE', 'Invalid freeze record', { freezeId })
  }
  assertFreezeExpectation(freeze, options.expected)
  const freezeAmount = normalizeMoney(toMoneyNumber(freeze.amount))
  if (freeze.status === 'confirmed') return 'already_settled'
  if (freeze.status !== 'pending') {
    throw new BillingOperationError('BILLING_FREEZE_NOT_PENDING', 'Freeze is not pending', {
      freezeId,
      status: freeze.status,
    })
  }
  const requested = Number(options?.chargedAmount)
  const chargedAmount = normalizeMoney(Number.isFinite(requested) ? requested : freezeAmount)
  if (chargedAmount < 0 || chargedAmount - freezeAmount > MONEY_EPSILON) {
    throw new BillingOperationError('BILLING_INVALID_CHARGED_AMOUNT', 'Invalid chargedAmount', {
      freezeId,
      chargedAmount,
      freezeAmount,
    })
  }
  const refundAmount = normalizeMoney(Math.max(0, freezeAmount - chargedAmount))
  const switched = await tx.balanceFreeze.updateMany({
    where: { id: freezeId, status: 'pending' },
    data: { status: 'confirmed' },
  })
  if (switched.count === 0) {
    const latest = await tx.balanceFreeze.findUnique({ where: { id: freezeId } })
    if (latest?.status === 'confirmed') return 'already_settled'
    throw new BillingOperationError('BILLING_FREEZE_NOT_PENDING', 'Freeze is not pending', {
      freezeId,
      status: latest?.status || null,
    })
  }
  const updatedBalance = await tx.userBalance.update({
    where: { userId: freeze.userId },
    data: {
      frozenAmount: { decrement: freezeAmount },
      totalSpent: { increment: chargedAmount },
      ...(refundAmount > 0 ? { balance: { increment: refundAmount } } : {}),
    },
  })
  if (chargedAmount > 0) {
    await recordUsageCostOnly(tx, {
      ...recordParams,
      userId: freeze.userId,
      cost: chargedAmount,
      balanceAfter: toMoneyNumber(updatedBalance.balance),
      freezeId: freeze.id,
    })
  }
  return 'settled'
}

export async function confirmChargeWithRecord(
  freezeId: string,
  recordParams: LedgerRecordParams,
  options?: { chargedAmount?: number },
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const freeze = await tx.balanceFreeze.findUnique({ where: { id: freezeId } })
      if (!freeze) throw new BillingOperationError('BILLING_INVALID_FREEZE', 'Invalid freeze record', { freezeId })
      await confirmChargeWithRecordInTransaction(tx, freezeId, recordParams, {
        chargedAmount: options?.chargedAmount,
        expected: {
          userId: freeze.userId,
          taskId: freeze.taskId,
          amount: toMoneyNumber(freeze.amount),
        },
      })
    }, { maxWait: 10_000, timeout: 10_000 })
    return true
  } catch (error) {
    _ulogError('[Billing] confirm charge failed:', error)
    if (error instanceof BillingOperationError) {
      throw error
    }
    if (error instanceof Error) {
      throw new BillingOperationError('BILLING_CONFIRM_FAILED', error.message, { freezeId }, error)
    }
    throw new BillingOperationError('BILLING_CONFIRM_FAILED', `confirm charge failed: ${String(error)}`, { freezeId })
  }
}

export async function rollbackFreezeInTransaction(
  tx: Prisma.TransactionClient,
  freezeId: string,
  expected: FreezeExpectation,
): Promise<'rolled_back' | 'already_rolled_back'> {
  const freeze = await tx.balanceFreeze.findUnique({ where: { id: freezeId } })
  if (!freeze) {
    throw new BillingOperationError('BILLING_INVALID_FREEZE', 'Invalid freeze record', { freezeId })
  }
  assertFreezeExpectation(freeze, expected)
  const freezeAmount = normalizeMoney(toMoneyNumber(freeze.amount))
  if (freeze.status === 'rolled_back') return 'already_rolled_back'
  if (freeze.status !== 'pending') {
    throw new BillingOperationError('BILLING_FREEZE_NOT_PENDING', 'Freeze is not pending', {
      freezeId,
      status: freeze.status,
    })
  }
  const switched = await tx.balanceFreeze.updateMany({
    where: { id: freezeId, status: 'pending' },
    data: { status: 'rolled_back' },
  })
  if (switched.count === 0) {
    const latest = await tx.balanceFreeze.findUnique({ where: { id: freezeId } })
    if (latest?.status === 'rolled_back') return 'already_rolled_back'
    throw new BillingOperationError('BILLING_FREEZE_NOT_PENDING', 'Freeze is not pending', {
      freezeId,
      status: latest?.status || null,
    })
  }
  await tx.userBalance.update({
    where: { userId: freeze.userId },
    data: {
      balance: { increment: freezeAmount },
      frozenAmount: { decrement: freezeAmount },
    },
  })
  return 'rolled_back'
}

export async function rollbackFreeze(freezeId: string): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const freeze = await tx.balanceFreeze.findUnique({ where: { id: freezeId } })
      if (!freeze) throw new BillingOperationError('BILLING_INVALID_FREEZE', 'Invalid freeze record', { freezeId })
      await rollbackFreezeInTransaction(tx, freezeId, {
        userId: freeze.userId,
        taskId: freeze.taskId,
        amount: toMoneyNumber(freeze.amount),
      })
    })

    return true
  } catch (error) {
    _ulogError('[Billing] rollback freeze failed:', error)
    return false
  }
}

export async function increasePendingFreezeAmountInTransaction(
  tx: Prisma.TransactionClient,
  freezeId: string,
  delta: number,
): Promise<boolean> {
  const normalizedDelta = normalizeMoney(Number(delta))
  if (!Number.isFinite(normalizedDelta) || normalizedDelta < 0) {
    throw new BillingOperationError('BILLING_INVALID_DELTA', 'delta must be a non-negative number', {
      freezeId,
      delta,
    })
  }
  if (normalizedDelta === 0) {
    return true
  }

  const freeze = await tx.balanceFreeze.findUnique({ where: { id: freezeId } })
  if (!freeze) {
    throw new BillingOperationError('BILLING_INVALID_FREEZE', 'Invalid freeze record', { freezeId })
  }
  if (freeze.status === 'confirmed') return true
  if (freeze.status !== 'pending') {
    throw new BillingOperationError('BILLING_FREEZE_NOT_PENDING', 'Freeze is not pending', {
      freezeId,
      status: freeze.status,
    })
  }
  const updated = await tx.userBalance.updateMany({
    where: { userId: freeze.userId, balance: { gte: normalizedDelta } },
    data: {
      balance: { decrement: normalizedDelta },
      frozenAmount: { increment: normalizedDelta },
    },
  })
  if (updated.count === 0) return false
  const switched = await tx.balanceFreeze.updateMany({
    where: { id: freezeId, status: 'pending' },
    data: { amount: { increment: normalizedDelta } },
  })
  if (switched.count === 0) {
    throw new BillingOperationError('BILLING_FREEZE_NOT_PENDING', 'Freeze is not pending', { freezeId })
  }
  return true
}

export async function increasePendingFreezeAmount(freezeId: string, delta: number): Promise<boolean> {
  const normalizedDelta = normalizeMoney(Number(delta))
  try {
    return await prisma.$transaction(async (tx) => (
      await increasePendingFreezeAmountInTransaction(tx, freezeId, normalizedDelta)
    ))
  } catch (error) {
    _ulogError('[Billing] increase pending freeze failed:', error)
    if (error instanceof BillingOperationError) {
      throw error
    }
    if (error instanceof Error) {
      throw new BillingOperationError('BILLING_FREEZE_EXPAND_FAILED', error.message, { freezeId, delta: normalizedDelta }, error)
    }
    throw new BillingOperationError('BILLING_FREEZE_EXPAND_FAILED', `increase freeze failed: ${String(error)}`, { freezeId, delta: normalizedDelta })
  }
}

export async function recordShadowUsageInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  params: {
    projectId: string
    episodeId?: string | null
    taskType?: string | null
    action: string
    apiType: ApiType
    model: string
    quantity: number
    unit: UsageUnit
    cost: number
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const balance = await tx.userBalance.upsert({
    where: { userId },
    create: { userId, balance: 0, frozenAmount: 0, totalSpent: 0 },
    update: {},
  })
  const metadataSummary = params.metadata
    ? JSON.stringify(params.metadata).slice(0, 500)
    : ''
  await tx.balanceTransaction.create({
    data: {
      userId,
      type: 'shadow_consume',
      amount: 0,
      balanceAfter: toMoneyNumber(balance.balance),
      description: `[SHADOW] ${params.action} - ${params.model} - ${params.cost.toFixed(4)} credits${metadataSummary ? ` | ${metadataSummary}` : ''}`,
      relatedId: null,
      freezeId: null,
      projectId: params.projectId || null,
      episodeId: params.episodeId || null,
      taskType: params.taskType || params.action || null,
      billingMeta: buildBillingMeta(params),
    },
  })
}

export async function recordShadowUsage(
  userId: string,
  params: Parameters<typeof recordShadowUsageInTransaction>[2],
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      await recordShadowUsageInTransaction(tx, userId, params)
    })
    return true
  } catch (error) {
    _ulogError('[Billing] record shadow usage failed:', error)
    return false
  }
}

type AddBalanceOptions = {
  reason?: string
  operatorId?: string
  externalOrderId?: string
  idempotencyKey?: string
  relatedId?: string
  billingMeta?: Record<string, unknown>
  type?: 'recharge' | 'adjust'
}

function resolveAddBalanceOptions(reasonOrOptions?: string | AddBalanceOptions): AddBalanceOptions {
  if (typeof reasonOrOptions === 'string') {
    return { reason: reasonOrOptions, type: 'recharge' }
  }
  return {
    reason: reasonOrOptions?.reason,
    operatorId: reasonOrOptions?.operatorId,
    externalOrderId: reasonOrOptions?.externalOrderId,
    idempotencyKey: reasonOrOptions?.idempotencyKey,
    relatedId: reasonOrOptions?.relatedId,
    billingMeta: reasonOrOptions?.billingMeta,
    type: reasonOrOptions?.type || 'recharge',
  }
}

export async function addBalanceWithTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  reasonOrOptions?: string | AddBalanceOptions,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number')
  }
  const options = resolveAddBalanceOptions(reasonOrOptions)
  const transactionType = options.type || 'recharge'
  const relatedId = options.relatedId || options.externalOrderId || null

  if (options.idempotencyKey) {
    const existing = await tx.balanceTransaction.findFirst({
      where: {
        userId,
        type: transactionType,
        idempotencyKey: options.idempotencyKey,
      },
      select: { id: true },
    })
    if (existing) return
  }

  const updatedBalance = await tx.userBalance.upsert({
    where: { userId },
    create: { userId, balance: amount, frozenAmount: 0, totalSpent: 0 },
    update: { balance: { increment: amount } },
  })

  const auditSummary = JSON.stringify({
    reason: options.reason || null,
    operatorId: options.operatorId || null,
    externalOrderId: options.externalOrderId || null,
    idempotencyKey: options.idempotencyKey || null,
  })

  await tx.balanceTransaction.create({
    data: {
      userId,
      type: transactionType,
      amount,
      balanceAfter: toMoneyNumber(updatedBalance.balance),
      description: `${options.reason || 'balance recharge'}${auditSummary ? ` | audit=${auditSummary}` : ''}`,
      relatedId,
      freezeId: null,
      operatorId: options.operatorId || null,
      externalOrderId: options.externalOrderId || null,
      idempotencyKey: options.idempotencyKey || null,
      billingMeta: options.billingMeta ? JSON.stringify(options.billingMeta) : null,
    },
  })
}

export type ApplyBalanceAdjustmentOptions = {
  reason: string
  externalOrderId: string
  idempotencyKey: string
  relatedId: string
  billingMeta?: Record<string, unknown>
}

export async function applyBalanceAdjustmentWithTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  signedAmount: number,
  options: ApplyBalanceAdjustmentOptions,
): Promise<'applied' | 'already_applied'> {
  const normalizedAmount = normalizeMoney(signedAmount)
  if (!Number.isFinite(normalizedAmount) || Math.abs(normalizedAmount) <= MONEY_EPSILON) {
    throw new BillingOperationError('BILLING_INVALID_ADJUSTMENT_AMOUNT', 'adjustment amount must be a non-zero number', {
      signedAmount,
    })
  }

  const existing = await tx.balanceTransaction.findFirst({
    where: {
      userId,
      type: 'adjust',
      idempotencyKey: options.idempotencyKey,
    },
    select: { id: true, amount: true, relatedId: true },
  })
  if (existing) {
    const existingAmount = normalizeMoney(toMoneyNumber(existing.amount))
    if (
      Math.abs(existingAmount - normalizedAmount) > MONEY_EPSILON
      || existing.relatedId !== options.relatedId
    ) {
      throw new BillingOperationError('BILLING_ADJUSTMENT_IDEMPOTENCY_CONFLICT', 'adjustment idempotency identity has conflicting facts', {
        idempotencyKey: options.idempotencyKey,
        existingAmount,
        requestedAmount: normalizedAmount,
        existingRelatedId: existing.relatedId,
        requestedRelatedId: options.relatedId,
      })
    }
    return 'already_applied'
  }

  const updatedBalance = await tx.userBalance.upsert({
    where: { userId },
    create: { userId, balance: normalizedAmount, frozenAmount: 0, totalSpent: 0 },
    update: { balance: { increment: normalizedAmount } },
  })

  await tx.balanceTransaction.create({
    data: {
      userId,
      type: 'adjust',
      amount: normalizedAmount,
      balanceAfter: toMoneyNumber(updatedBalance.balance),
      description: options.reason,
      relatedId: options.relatedId,
      freezeId: null,
      externalOrderId: options.externalOrderId,
      idempotencyKey: options.idempotencyKey,
      billingMeta: options.billingMeta ? JSON.stringify(options.billingMeta) : null,
    },
  })
  return 'applied'
}

export async function addBalance(userId: string, amount: number, reasonOrOptions?: string | AddBalanceOptions): Promise<boolean> {
  try {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('amount must be a positive number')
    }
    const options = resolveAddBalanceOptions(reasonOrOptions)

    await prisma.$transaction(async (tx) => {
      await addBalanceWithTransaction(tx, userId, amount, options)
    })

    _ulogInfo(`[Balance] add balance success: userId=${userId}, credits=${amount}, reason=${options.reason || 'N/A'}`)
    return true
  } catch (error) {
    _ulogError('[Balance] add balance failed:', error)
    return false
  }
}
