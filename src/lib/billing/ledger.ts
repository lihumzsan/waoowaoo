import { describeUnknownError } from '@/lib/errors/normalize'
import { logInfo as _ulogInfo, logError as _ulogError, createScopedLogger } from '@/lib/logging/core'
import type { ErrorFields } from '@/lib/logging/types'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordUsageCostOnly, buildBillingMeta, buildBillingMetaRecord, isProjectScoped } from './reporting'
import type { ApiType, UsageUnit } from './cost'
import { BillingOperationError } from './errors'
import { toMoneyNumber, type MoneyValue } from './money'
import { assertCreditAmount, assertSignedCreditAmount, CreditAmountError } from './credits'
import {
  applyRefundExpiry,
  planPoolDebit,
  splitSettlement,
  usableCredits,
  usableSubscriptionCredits,
  type CreditPoolState,
} from './credit-pools'

const ledgerLogger = createScopedLogger({ module: 'billing.ledger' })

function toErrorFields(error: unknown): ErrorFields {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error instanceof BillingOperationError ? error.code : undefined,
    }
  }
  return { message: describeUnknownError(error) }
}

type LedgerRecordParams = {
  projectId: string
  action: string
  apiType: ApiType
  model: string
  quantity: number
  unit: UsageUnit
  metadata?: Record<string, unknown>
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
  /** Spendable total: unexpired subscription credits plus permanent credits. */
  balance: number
  /** Permanent pool only. */
  rechargeCredits: number
  /** Subscription pool, already zeroed if the period has ended. */
  subscriptionCredits: number
  subscriptionExpiresAt: Date | null
  frozenAmount: number
  totalSpent: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Credits are whole numbers everywhere in the ledger, so amounts are compared
 * with `===` rather than against an epsilon, and any fractional value is a
 * caller bug that must fail at this boundary instead of being rounded away.
 */
function normalizeMoney(value: number): number {
  return assertSignedCreditAmount(value, 'amount')
}

type UserBalanceRow = {
  balance: MoneyValue
  subscriptionCredits: MoneyValue
  subscriptionExpiresAt: Date | null
}

function toPoolState(row: UserBalanceRow): CreditPoolState {
  return {
    rechargeCredits: toMoneyNumber(row.balance),
    subscriptionCredits: toMoneyNumber(row.subscriptionCredits),
    subscriptionExpiresAt: row.subscriptionExpiresAt,
  }
}

function toBalanceSnapshot(balance: {
  id: string
  userId: string
  balance: MoneyValue
  subscriptionCredits: MoneyValue
  subscriptionExpiresAt: Date | null
  frozenAmount: MoneyValue
  totalSpent: MoneyValue
  createdAt: Date
  updatedAt: Date
}): BalanceSnapshot {
  const now = new Date()
  const poolState = toPoolState(balance)
  return {
    id: balance.id,
    userId: balance.userId,
    // `balance` stays the spendable total so every existing consumer keeps
    // working; the pools it is made of are reported alongside it.
    balance: usableCredits(poolState, now),
    rechargeCredits: toMoneyNumber(balance.balance),
    subscriptionCredits: usableSubscriptionCredits(poolState, now),
    subscriptionExpiresAt: balance.subscriptionExpiresAt,
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

type LockedBalanceRow = {
  balance: number
  subscriptionCredits: number
  subscriptionExpiresAt: Date | null
}

export type RealtimeUsageDebitResult = {
  chargedCredits: number
  balanceAfter: number
}

/**
 * Debit up to the currently available whole credits for one post-priced usage
 * fact. The caller owns usage identity and exact-price accumulation; this
 * function remains the only writer for balance and BalanceTransaction.
 */
export async function consumeAvailableCreditsInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    requiredCredits: number
    idempotencyKey: string
    projectId: string
    action: string
    apiType: ApiType
    model: string
    quantity: number
    unit: UsageUnit
    metadata?: Record<string, unknown>
  },
): Promise<RealtimeUsageDebitResult> {
  const requiredCredits = assertCreditAmount(params.requiredCredits, 'requiredCredits')
  await tx.userBalance.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, balance: 0, frozenAmount: 0, totalSpent: 0 },
    update: {},
  })
  const rows = await tx.$queryRaw<LockedBalanceRow[]>`
    SELECT balance, subscriptionCredits, subscriptionExpiresAt
    FROM user_balances
    WHERE userId = ${params.userId}
    FOR UPDATE
  `
  const row = rows[0]
  if (!row) {
    throw new BillingOperationError('BILLING_BALANCE_NOT_FOUND', 'balance row missing after initialization', {
      userId: params.userId,
    })
  }
  const now = new Date()
  const state = toPoolState(row)
  const available = usableCredits(state, now)
  const chargedCredits = Math.min(requiredCredits, available)
  if (chargedCredits === 0) {
    return { chargedCredits: 0, balanceAfter: available }
  }
  const split = planPoolDebit(state, chargedCredits, now)
  if (!split) {
    throw new BillingOperationError('BILLING_BALANCE_DEBIT_CONFLICT', 'locked balance could not fund realtime usage', {
      userId: params.userId,
      requiredCredits,
      available,
    })
  }
  const updated = await tx.userBalance.update({
    where: { userId: params.userId },
    data: {
      ...(split.recharge > 0 ? { balance: { decrement: split.recharge } } : {}),
      ...(split.subscription > 0
        ? { subscriptionCredits: { decrement: split.subscription } }
        : {}),
      totalSpent: { increment: chargedCredits },
    },
  })
  const balanceAfter = usableCredits(toPoolState(updated), now)
  await tx.balanceTransaction.create({
    data: {
      userId: params.userId,
      type: 'consume',
      amount: -chargedCredits,
      balanceAfter,
      description: `${params.action} - ${params.model}`,
      relatedId: params.idempotencyKey,
      idempotencyKey: params.idempotencyKey,
      projectId: isProjectScoped(params.projectId) ? params.projectId : null,
      taskType: params.action,
      billingMeta: buildBillingMeta({
        quantity: params.quantity,
        unit: params.unit,
        model: params.model,
        apiType: params.apiType,
        metadata: {
          ...(params.metadata ?? {}),
          chargedCost: chargedCredits,
          subscriptionCredits: split.subscription,
          rechargeCredits: split.recharge,
        },
      }),
    },
  })
  ledgerLogger.info({
    audit: true,
    action: 'billing.llm_realtime.settled',
    message: 'realtime LLM usage settled',
    userId: params.userId,
    projectId: params.projectId,
    details: {
      usageId: params.idempotencyKey,
      chargedCredits,
      balanceAfter,
    },
  })
  return { chargedCredits, balanceAfter }
}

type FreezeBalanceOptions = {
  source?: string
  taskId?: string
  requestId?: string
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

function requirePositiveFreezeAmount(amount: number): number {
  try {
    const normalizedAmount = assertCreditAmount(Number(amount), 'freezeAmount')
    if (normalizedAmount <= 0) {
      throw new CreditAmountError('freeze amount must be greater than zero', amount)
    }
    return normalizedAmount
  } catch (error) {
    if (!(error instanceof CreditAmountError)) throw error
    throw new BillingOperationError(
      'BILLING_INVALID_FREEZE_AMOUNT',
      'freeze amount must be a positive whole number of credits',
      { amount },
      error,
    )
  }
}

export type FreezeExpectation = {
  userId: string
  taskId: string | null
  amount: number
}

function assertFreezeExpectation(
  freeze: { id: string; userId: string; taskId: string | null; amount: number },
  expected: FreezeExpectation,
): void {
  const amount = normalizeMoney(toMoneyNumber(freeze.amount))
  const expectedAmount = normalizeMoney(expected.amount)
  if (
    freeze.userId !== expected.userId
    || freeze.taskId !== expected.taskId
    || amount !== expectedAmount
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

function readMetadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readScopedProjectId(metadata: Record<string, unknown> | null | undefined): string | null {
  const projectId = readMetadataString(metadata, 'projectId')
  return projectId && isProjectScoped(projectId) ? projectId : null
}

function parseStoredFreezeMetadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function buildFreezeAuditMeta(
  amounts: Record<string, number>,
  metadata: Record<string, unknown> | null | undefined,
): string {
  const quantity = Number(metadata?.quantity)
  const unit = readMetadataString(metadata, 'unit')
  const model = readMetadataString(metadata, 'model')
  const apiType = readMetadataString(metadata, 'apiType')
  const base = unit && model && apiType && Number.isFinite(quantity)
    ? buildBillingMetaRecord({ quantity, unit, model, apiType, metadata: metadata ?? undefined })
    : {}
  return JSON.stringify({ ...base, ...amounts })
}

type FreezeAuditRow = {
  type: 'freeze' | 'refund'
  userId: string
  freezeId: string
  balanceAfter: number
  description: string
  billingMeta: string
  projectId?: string | null
  taskType?: string | null
}

/**
 * Freeze / rollback / settlement partial refunds are internal balance <-> frozen
 * transfers: the reconcile invariant `balance + frozenAmount == SUM(amount)`
 * only holds if these rows carry amount = 0. The transferred amounts live in
 * billingMeta ({ freezeAmount } / { refundedAmount }) for display and audit.
 */
async function appendFreezeAuditTransaction(tx: Prisma.TransactionClient, row: FreezeAuditRow): Promise<void> {
  await tx.balanceTransaction.create({
    data: {
      userId: row.userId,
      type: row.type,
      amount: 0,
      balanceAfter: row.balanceAfter,
      description: row.description,
      relatedId: row.freezeId,
      freezeId: row.freezeId,
      projectId: row.projectId || null,
      taskType: row.taskType || null,
      billingMeta: row.billingMeta,
    },
  })
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
        && existingAmount === normalizedAmount
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
  const now = new Date()
  const split = planPoolDebit(toPoolState(balance), normalizedAmount, now)
  if (!split) {
    return {
      status: 'insufficient_balance',
      required: normalizedAmount,
      available: usableCredits(toPoolState(balance), now),
    }
  }
  // Both pools move under one conditional update, so a concurrent freeze that
  // drains either pool loses the race instead of overdrawing it. The expiry
  // bound is part of the condition: a period that ends between planning the
  // split and applying it must not fund the freeze.
  const updated = await tx.userBalance.updateMany({
    where: {
      userId,
      balance: { gte: split.recharge },
      ...(split.subscription > 0
        ? {
            subscriptionCredits: { gte: split.subscription },
            subscriptionExpiresAt: { gt: now },
          }
        : {}),
    },
    data: {
      ...(split.recharge > 0 ? { balance: { decrement: split.recharge } } : {}),
      ...(split.subscription > 0
        ? { subscriptionCredits: { decrement: split.subscription } }
        : {}),
      frozenAmount: { increment: normalizedAmount },
    },
  })
  if (updated.count === 0) {
    const latest = await tx.userBalance.findUnique({ where: { userId } })
    return {
      status: 'insufficient_balance',
      required: normalizedAmount,
      available: usableCredits(toPoolState(latest ?? balance), now),
    }
  }
  const freezeId = `freeze_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  await tx.balanceFreeze.create({
    data: {
      id: freezeId,
      userId,
      amount: normalizedAmount,
      subscriptionAmount: split.subscription,
      status: 'pending',
      source: options?.source || 'sync',
      taskId: options?.taskId || null,
      requestId: options?.requestId || null,
      idempotencyKey: options?.idempotencyKey || null,
      metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
    },
  })
  const balanceRow = await tx.userBalance.findUnique({ where: { userId } })
  const balanceAfter = balanceRow ? usableCredits(toPoolState(balanceRow), now) : 0
  const metadata = options?.metadata ?? null
  const action = readMetadataString(metadata, 'action') || readMetadataString(metadata, 'taskType')
  await appendFreezeAuditTransaction(tx, {
    type: 'freeze',
    userId,
    freezeId,
    balanceAfter,
    description: `[FREEZE] ${action || options?.source || 'sync'}`,
    billingMeta: buildFreezeAuditMeta({
      freezeAmount: normalizedAmount,
      ...(split.subscription > 0 ? { freezeSubscriptionAmount: split.subscription } : {}),
    }, metadata),
    projectId: readScopedProjectId(metadata),
    taskType: readMetadataString(metadata, 'taskType') || action,
  })
  ledgerLogger.info({
    audit: true,
    action: 'billing.freeze.created',
    message: 'billing freeze created',
    userId,
    taskId: options?.taskId || undefined,
    details: {
      freezeId,
      amount: normalizedAmount,
      balanceAfter,
      idempotencyKey: options?.idempotencyKey ?? null,
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
          }, error)
        }
        return existing.status === 'pending'
          && existingAmount === normalizedAmount
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
    throw new BillingOperationError('BILLING_FREEZE_FAILED', `freeze balance failed: ${describeUnknownError(error)}`, {
      userId,
      amount: normalizedAmount,
      idempotencyKey: options?.idempotencyKey ?? null,
    }, error)
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
  if (chargedAmount < 0 || chargedAmount > freezeAmount) {
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
  // The freeze recorded which pools funded it; the charge lands on the
  // subscription portion first and whatever is left over goes back to the pool
  // it came from. Subscription credits released after their period ended are
  // not restored — they would be spendable past their expiry — and the dropped
  // amount is recorded rather than silently lost.
  const now = new Date()
  const frozenSplit = {
    subscription: toMoneyNumber(freeze.subscriptionAmount),
    recharge: freezeAmount - toMoneyNumber(freeze.subscriptionAmount),
  }
  const settlement = splitSettlement(frozenSplit, chargedAmount)
  const balanceBefore = await tx.userBalance.findUniqueOrThrow({ where: { userId: freeze.userId } })
  const refundOutcome = applyRefundExpiry(settlement.refunded, toPoolState(balanceBefore), now)
  const updatedBalance = await tx.userBalance.update({
    where: { userId: freeze.userId },
    data: {
      frozenAmount: { decrement: freezeAmount },
      totalSpent: { increment: chargedAmount },
      ...(refundOutcome.restored.recharge > 0
        ? { balance: { increment: refundOutcome.restored.recharge } }
        : {}),
      ...(refundOutcome.restored.subscription > 0
        ? { subscriptionCredits: { increment: refundOutcome.restored.subscription } }
        : {}),
    },
  })
  const balanceAfter = usableCredits(toPoolState(updatedBalance), now)
  // A zero charge still appends an amount = 0 consume row so every settlement
  // is visible in the ledger trail.
  await recordUsageCostOnly(tx, {
    ...recordParams,
    userId: freeze.userId,
    cost: chargedAmount,
    balanceAfter,
    freezeId: freeze.id,
  })
  if (refundAmount > 0) {
    await appendFreezeAuditTransaction(tx, {
      type: 'refund',
      userId: freeze.userId,
      freezeId: freeze.id,
      balanceAfter,
      description: `[REFUND] settlement release - ${recordParams.action}`,
      billingMeta: JSON.stringify({
        ...buildBillingMetaRecord({
          quantity: recordParams.quantity,
          unit: recordParams.unit,
          model: recordParams.model,
          apiType: recordParams.apiType,
          metadata: recordParams.metadata,
        }),
        refundedAmount: refundAmount,
        ...(refundOutcome.restored.subscription > 0
          ? { refundedSubscriptionAmount: refundOutcome.restored.subscription }
          : {}),
        ...(refundOutcome.expired > 0 ? { expiredSubscriptionRefund: refundOutcome.expired } : {}),
      }),
      projectId: isProjectScoped(recordParams.projectId) ? recordParams.projectId : null,
      taskType: recordParams.taskType || recordParams.action || null,
    })
  }
  ledgerLogger.info({
    audit: true,
    action: 'billing.freeze.settled',
    message: 'billing freeze settled',
    userId: freeze.userId,
    taskId: freeze.taskId || undefined,
    details: {
      freezeId: freeze.id,
      amount: chargedAmount,
      balanceAfter,
      idempotencyKey: freeze.idempotencyKey ?? null,
    },
  })
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
    throw new BillingOperationError(
      'BILLING_CONFIRM_FAILED',
      `confirm charge failed: ${describeUnknownError(error)}`,
      { freezeId },
      error,
    )
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
  const now = new Date()
  const frozenSplit = {
    subscription: toMoneyNumber(freeze.subscriptionAmount),
    recharge: freezeAmount - toMoneyNumber(freeze.subscriptionAmount),
  }
  const balanceBefore = await tx.userBalance.findUniqueOrThrow({ where: { userId: freeze.userId } })
  const refundOutcome = applyRefundExpiry(frozenSplit, toPoolState(balanceBefore), now)
  const updatedBalance = await tx.userBalance.update({
    where: { userId: freeze.userId },
    data: {
      ...(refundOutcome.restored.recharge > 0
        ? { balance: { increment: refundOutcome.restored.recharge } }
        : {}),
      ...(refundOutcome.restored.subscription > 0
        ? { subscriptionCredits: { increment: refundOutcome.restored.subscription } }
        : {}),
      frozenAmount: { decrement: freezeAmount },
    },
  })
  const balanceAfter = usableCredits(toPoolState(updatedBalance), now)
  const storedMetadata = parseStoredFreezeMetadata(freeze.metadata)
  const action = readMetadataString(storedMetadata, 'action') || readMetadataString(storedMetadata, 'taskType')
  await appendFreezeAuditTransaction(tx, {
    type: 'refund',
    userId: freeze.userId,
    freezeId: freeze.id,
    balanceAfter,
    description: `[REFUND] freeze rollback${action ? ` - ${action}` : ''}`,
    billingMeta: buildFreezeAuditMeta({
      refundedAmount: freezeAmount,
      ...(refundOutcome.restored.subscription > 0
        ? { refundedSubscriptionAmount: refundOutcome.restored.subscription }
        : {}),
      ...(refundOutcome.expired > 0 ? { expiredSubscriptionRefund: refundOutcome.expired } : {}),
    }, storedMetadata),
    projectId: readScopedProjectId(storedMetadata),
    taskType: readMetadataString(storedMetadata, 'taskType') || action,
  })
  ledgerLogger.info({
    audit: true,
    action: 'billing.freeze.rolled_back',
    message: 'billing freeze rolled back',
    userId: freeze.userId,
    taskId: freeze.taskId || undefined,
    details: {
      freezeId: freeze.id,
      amount: freezeAmount,
      balanceAfter,
      idempotencyKey: freeze.idempotencyKey ?? null,
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
    const errorCode = error instanceof BillingOperationError ? error.code : 'BILLING_ROLLBACK_FAILED'
    const owner = await prisma.balanceFreeze
      .findUnique({ where: { id: freezeId }, select: { userId: true } })
      .catch(() => null)
    ledgerLogger.error({
      action: 'billing.freeze.rollback_failed',
      message: 'rollback freeze failed',
      errorCode,
      userId: owner?.userId,
      details: { freezeId },
      error: toErrorFields(error),
    })
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
  const now = new Date()
  const balanceRow = await tx.userBalance.findUnique({ where: { userId: freeze.userId } })
  if (!balanceRow) return false
  const split = planPoolDebit(toPoolState(balanceRow), normalizedDelta, now)
  if (!split) return false
  const updated = await tx.userBalance.updateMany({
    where: {
      userId: freeze.userId,
      balance: { gte: split.recharge },
      ...(split.subscription > 0
        ? {
            subscriptionCredits: { gte: split.subscription },
            subscriptionExpiresAt: { gt: now },
          }
        : {}),
    },
    data: {
      ...(split.recharge > 0 ? { balance: { decrement: split.recharge } } : {}),
      ...(split.subscription > 0
        ? { subscriptionCredits: { decrement: split.subscription } }
        : {}),
      frozenAmount: { increment: normalizedDelta },
    },
  })
  if (updated.count === 0) return false
  const switched = await tx.balanceFreeze.updateMany({
    where: { id: freezeId, status: 'pending' },
    data: {
      amount: { increment: normalizedDelta },
      ...(split.subscription > 0
        ? { subscriptionAmount: { increment: split.subscription } }
        : {}),
    },
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
    throw new BillingOperationError(
      'BILLING_FREEZE_EXPAND_FAILED',
      `increase freeze failed: ${describeUnknownError(error)}`,
      { freezeId, delta: normalizedDelta },
      error,
    )
  }
}

export async function recordShadowUsageInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  params: {
    projectId: string
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
      description: `[SHADOW] ${params.action} - ${params.model} - ${params.cost} credits${metadataSummary ? ` | ${metadataSummary}` : ''}`,
      relatedId: null,
      freezeId: null,
      projectId: params.projectId || null,
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
    if (existing) {
      ledgerLogger.info({
        action: 'billing.idempotent_replay.skipped',
        message: 'billing idempotent replay skipped',
        userId,
        details: { idempotencyKey: options.idempotencyKey, type: transactionType },
      })
      return
    }
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
  ledgerLogger.info({
    audit: true,
    action: 'billing.transaction.appended',
    message: 'balance transaction appended',
    userId,
    details: {
      type: transactionType,
      amount,
      balanceAfter: toMoneyNumber(updatedBalance.balance),
      idempotencyKey: options.idempotencyKey ?? null,
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
  if (normalizedAmount === 0) {
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
      existingAmount !== normalizedAmount
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
  ledgerLogger.info({
    audit: true,
    action: 'billing.transaction.appended',
    message: 'balance transaction appended',
    userId,
    details: {
      type: 'adjust',
      amount: normalizedAmount,
      balanceAfter: toMoneyNumber(updatedBalance.balance),
      idempotencyKey: options.idempotencyKey ?? null,
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
