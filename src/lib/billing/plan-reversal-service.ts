import type { Prisma } from '@prisma/client'
import { createScopedLogger } from '@/lib/logging/core'
import { lockSubscriptionBalanceInTransaction } from './subscription-ledger'
import { addMonths } from './subscription-service'

const planReversalLogger = createScopedLogger({ module: 'billing.plan-reversal' })

type PlanPurchaseMode = 'restart_now_v1' | 'legacy_extend_v1'

type PreviousTerm = {
  planId: string
  interval: string
  status: string
  termKey: string
  startsAt: Date
  endsAt: Date
}

type PlanPurchaseFact = {
  transactionId: string
  userId: string
  subscriptionId: string
  mode: PlanPurchaseMode
  paymentIntentId: string
  paymentAmountMinor: number
  paymentCurrency: string
  planId: string
  interval: string
  grantedCredits: number
  carriedCredits: number
  paidAt: Date
  termStartsAt: Date
  termEndsAt: Date
  previousSubscriptionCredits: number
  previousSubscriptionExpiresAt: Date | null
  previousTerm: PreviousTerm | null
  legacyPreviousTermEndsAt: Date | null
}

export interface PlanPaymentReversalInput {
  readonly eventId: string
  readonly objectType: 'refund' | 'dispute'
  readonly objectId: string
  readonly paymentIntentId: string
  readonly amountMinor: number
  readonly currency: string
  readonly occurredAt: Date
}

export type PlanPaymentReversalResult =
  | { readonly status: 'not_plan_purchase' }
  | { readonly status: 'reversed' | 'already_reversed'; readonly userId: string; readonly credits: number }

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function readDate(value: unknown): Date | null {
  const text = readString(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isFinite(date.getTime()) ? date : null
}

function parsePreviousTerm(value: unknown): PreviousTerm | null {
  if (value === null) return null
  const record = readRecord(value)
  if (!record) throw new Error('PLAN_PURCHASE_PREVIOUS_TERM_INVALID')
  const planId = readString(record.planId)
  const interval = readString(record.interval)
  const status = readString(record.status)
  const termKey = readString(record.termKey)
  const startsAt = readDate(record.startsAt)
  const endsAt = readDate(record.endsAt)
  if (!planId || !interval || !status || !termKey || !startsAt || !endsAt) {
    throw new Error('PLAN_PURCHASE_PREVIOUS_TERM_INVALID')
  }
  return { planId, interval, status, termKey, startsAt, endsAt }
}

function parsePlanPurchaseFact(row: {
  id: string
  userId: string
  relatedId: string | null
  billingMeta: string | null
}): PlanPurchaseFact {
  let meta: Record<string, unknown> | null = null
  try {
    meta = readRecord(row.billingMeta ? JSON.parse(row.billingMeta) : null)
  } catch {
    meta = null
  }
  const mode = readString(meta?.purchaseMode)
  const paymentIntentId = readString(meta?.paymentIntentId)
  const paymentAmountMinor = readInteger(meta?.paymentAmountMinor)
  const paymentCurrency = readString(meta?.paymentCurrency)?.toLowerCase() ?? null
  const planId = readString(meta?.planId)
  const interval = readString(meta?.interval)
  const grantedCredits = readInteger(meta?.grantedCredits)
  const carriedCredits = readInteger(meta?.carriedCredits) ?? 0
  const paidAt = readDate(meta?.paidAt)
  const termStartsAt = readDate(meta?.termStartsAt)
  const termEndsAt = readDate(meta?.termEndsAt)
  const previousSubscriptionCredits = readInteger(meta?.previousSubscriptionCredits) ?? 0
  const previousSubscriptionExpiresAt = meta?.previousSubscriptionExpiresAt === null
    ? null
    : readDate(meta?.previousSubscriptionExpiresAt)
  const legacyPreviousTermEndsAt = meta?.previousTermEndsAt === undefined
    ? null
    : readDate(meta.previousTermEndsAt)
  if (
    !row.relatedId
    || (mode !== 'restart_now_v1' && mode !== 'legacy_extend_v1')
    || !paymentIntentId
    || paymentAmountMinor === null
    || paymentAmountMinor <= 0
    || !paymentCurrency
    || !planId
    || !interval
    || grantedCredits === null
    || grantedCredits < 0
    || !paidAt
    || !termStartsAt
    || !termEndsAt
    || (mode === 'legacy_extend_v1' && !legacyPreviousTermEndsAt)
  ) {
    throw new Error('PLAN_PURCHASE_REVERSAL_FACTS_INCOMPLETE')
  }
  return {
    transactionId: row.id,
    userId: row.userId,
    subscriptionId: row.relatedId,
    mode,
    paymentIntentId,
    paymentAmountMinor,
    paymentCurrency,
    planId,
    interval,
    grantedCredits,
    carriedCredits,
    paidAt,
    termStartsAt,
    termEndsAt,
    previousSubscriptionCredits,
    previousSubscriptionExpiresAt,
    previousTerm: mode === 'restart_now_v1' ? parsePreviousTerm(meta?.previousTerm) : null,
    legacyPreviousTermEndsAt,
  }
}

async function findPlanPurchaseFact(
  tx: Prisma.TransactionClient,
  paymentIntentId: string,
): Promise<PlanPurchaseFact | null> {
  const row = await tx.balanceTransaction.findFirst({
    where: {
      type: 'plan_purchase',
      externalOrderId: paymentIntentId,
    },
    select: { id: true, userId: true, relatedId: true, billingMeta: true },
  })
  return row ? parsePlanPurchaseFact(row) : null
}

async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM \`user\` WHERE id = ${userId} FOR UPDATE
  `
  if (!rows[0]) throw new Error('PLAN_REVERSAL_USER_NOT_FOUND')
}

function assertFullMatchingReversal(fact: PlanPurchaseFact, input: PlanPaymentReversalInput): void {
  if (input.paymentIntentId !== fact.paymentIntentId) throw new Error('PLAN_REVERSAL_PAYMENT_ID_MISMATCH')
  if (input.currency.toLowerCase() !== fact.paymentCurrency) throw new Error('PLAN_REVERSAL_CURRENCY_MISMATCH')
  if (input.amountMinor !== fact.paymentAmountMinor) throw new Error('PLAN_REVERSAL_MUST_BE_FULL_AMOUNT')
}

export async function reversePlanPaymentInTransaction(
  tx: Prisma.TransactionClient,
  input: PlanPaymentReversalInput,
): Promise<PlanPaymentReversalResult> {
  const fact = await findPlanPurchaseFact(tx, input.paymentIntentId)
  if (!fact) return { status: 'not_plan_purchase' }
  assertFullMatchingReversal(fact, input)
  await lockUser(tx, fact.userId)

  const idempotencyKey = `stripe:${input.objectType}:${input.objectId}:plan:debit`
  const existing = await tx.balanceTransaction.findFirst({
    where: { userId: fact.userId, type: 'plan_reversal', idempotencyKey },
    select: { id: true },
  })
  if (existing) {
    return { status: 'already_reversed', userId: fact.userId, credits: fact.grantedCredits }
  }

  const subscription = await tx.subscription.findUnique({ where: { id: fact.subscriptionId } })
  if (!subscription || subscription.userId !== fact.userId) {
    throw new Error('PLAN_REVERSAL_SUBSCRIPTION_NOT_FOUND')
  }
  const balance = await lockSubscriptionBalanceInTransaction(tx, fact.userId)
  const before = {
    planId: subscription.planId,
    interval: subscription.interval,
    status: subscription.status,
    termKey: subscription.currentTermKey,
    startsAt: subscription.currentPeriodStart,
    endsAt: subscription.currentPeriodEnd,
    subscriptionCredits: balance.subscriptionCredits,
    subscriptionExpiresAt: balance.subscriptionExpiresAt,
  }

  let afterSubscriptionCredits = balance.subscriptionCredits
  let afterSubscriptionExpiresAt = balance.subscriptionExpiresAt
  if (fact.mode === 'legacy_extend_v1') {
    if (
      subscription.planId !== fact.planId
      || subscription.currentPeriodEnd.getTime() !== fact.termEndsAt.getTime()
    ) {
      throw new Error('PLAN_REVERSAL_LEGACY_TERM_CHANGED')
    }
    const laterGrant = await tx.subscriptionGrant.findFirst({
      where: {
        subscriptionId: subscription.id,
        periodIndex: { gt: 0 },
      },
      select: { id: true },
    })
    if (laterGrant) throw new Error('PLAN_REVERSAL_LEGACY_TERM_ALREADY_GRANTED')
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { currentPeriodEnd: fact.legacyPreviousTermEndsAt! },
    })
  } else {
    if (subscription.currentTermKey !== fact.paymentIntentId) {
      throw new Error('PLAN_REVERSAL_TERM_IS_NOT_CURRENT')
    }
    const expectedUntouchedCredits = fact.carriedCredits + fact.grantedCredits
    if (
      balance.subscriptionCredits !== expectedUntouchedCredits
      || balance.subscriptionExpiresAt?.getTime() !== addMonths(fact.termStartsAt, 1).getTime()
    ) {
      throw new Error('PLAN_REVERSAL_TERM_HAS_USAGE')
    }
    const previousStillUsable = fact.previousSubscriptionExpiresAt !== null
      && fact.previousSubscriptionExpiresAt.getTime() > input.occurredAt.getTime()
    afterSubscriptionCredits = previousStillUsable ? fact.previousSubscriptionCredits : 0
    afterSubscriptionExpiresAt = previousStillUsable ? fact.previousSubscriptionExpiresAt : null
    await tx.userBalance.update({
      where: { userId: fact.userId },
      data: {
        subscriptionCredits: afterSubscriptionCredits,
        subscriptionExpiresAt: afterSubscriptionExpiresAt,
      },
    })
    if (fact.previousTerm) {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: fact.previousTerm.planId,
          interval: fact.previousTerm.interval,
          status: fact.previousTerm.endsAt.getTime() > input.occurredAt.getTime() ? 'active' : 'expired',
          currentTermKey: fact.previousTerm.termKey,
          currentPeriodStart: fact.previousTerm.startsAt,
          currentPeriodEnd: fact.previousTerm.endsAt,
        },
      })
    } else {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: 'refunded' },
      })
    }
  }

  const afterTerm = await tx.subscription.findUniqueOrThrow({ where: { id: subscription.id } })
  await tx.balanceTransaction.create({
    data: {
      userId: fact.userId,
      type: 'plan_reversal',
      amount: 0,
      balanceAfter: balance.balance,
      description: `[PLAN ${input.objectType.toUpperCase()}] ${fact.planId}`,
      relatedId: fact.transactionId,
      externalOrderId: `stripe:${input.objectType}:${input.objectId}`,
      idempotencyKey,
      billingMeta: JSON.stringify({
        provider: 'stripe',
        eventId: input.eventId,
        objectType: input.objectType,
        objectId: input.objectId,
        paymentIntentId: input.paymentIntentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        purchaseMode: fact.mode,
        revokedCredits: fact.grantedCredits,
        before: {
          ...before,
          startsAt: before.startsAt.toISOString(),
          endsAt: before.endsAt.toISOString(),
          subscriptionExpiresAt: before.subscriptionExpiresAt?.toISOString() ?? null,
        },
        afterTerm: {
          planId: afterTerm.planId,
          interval: afterTerm.interval,
          status: afterTerm.status,
          termKey: afterTerm.currentTermKey,
          startsAt: afterTerm.currentPeriodStart.toISOString(),
          endsAt: afterTerm.currentPeriodEnd.toISOString(),
        },
        afterSubscriptionCredits,
        afterSubscriptionExpiresAt: afterSubscriptionExpiresAt?.toISOString() ?? null,
      }),
    },
  })

  planReversalLogger.info({
    audit: true,
    action: 'billing.plan.reversed',
    message: 'plan payment entitlement reversed',
    userId: fact.userId,
    details: {
      paymentIntentId: fact.paymentIntentId,
      objectType: input.objectType,
      objectId: input.objectId,
      purchaseMode: fact.mode,
      revokedCredits: fact.grantedCredits,
    },
  })
  return { status: 'reversed', userId: fact.userId, credits: fact.grantedCredits }
}

type StoredReversalState = {
  userId: string
  purchaseTransactionId: string
  purchaseMode: PlanPurchaseMode
  before: PreviousTerm & {
    subscriptionCredits: number
    subscriptionExpiresAt: Date | null
  }
  afterTerm: PreviousTerm
  afterSubscriptionCredits: number
  afterSubscriptionExpiresAt: Date | null
}

function parseStoredReversal(row: {
  userId: string
  relatedId: string | null
  billingMeta: string | null
}): StoredReversalState {
  let meta: Record<string, unknown> | null = null
  try {
    meta = readRecord(row.billingMeta ? JSON.parse(row.billingMeta) : null)
  } catch {
    meta = null
  }
  const purchaseMode = readString(meta?.purchaseMode)
  const beforeRecord = readRecord(meta?.before)
  const afterTerm = parsePreviousTerm(meta?.afterTerm)
  const beforeTerm = parsePreviousTerm(beforeRecord)
  const beforeCredits = readInteger(beforeRecord?.subscriptionCredits)
  const beforeExpiresAt = beforeRecord?.subscriptionExpiresAt === null
    ? null
    : readDate(beforeRecord?.subscriptionExpiresAt)
  const afterCredits = readInteger(meta?.afterSubscriptionCredits)
  const afterExpiresAt = meta?.afterSubscriptionExpiresAt === null
    ? null
    : readDate(meta?.afterSubscriptionExpiresAt)
  if (
    !row.relatedId
    || (purchaseMode !== 'restart_now_v1' && purchaseMode !== 'legacy_extend_v1')
    || !beforeTerm
    || beforeCredits === null
    || !afterTerm
    || afterCredits === null
  ) {
    throw new Error('PLAN_REVERSAL_RESTORE_FACTS_INCOMPLETE')
  }
  return {
    userId: row.userId,
    purchaseTransactionId: row.relatedId,
    purchaseMode,
    before: {
      ...beforeTerm,
      subscriptionCredits: beforeCredits,
      subscriptionExpiresAt: beforeExpiresAt,
    },
    afterTerm,
    afterSubscriptionCredits: afterCredits,
    afterSubscriptionExpiresAt: afterExpiresAt,
  }
}

export type RestorePlanPaymentReversalResult =
  | { readonly status: 'not_plan_reversal' }
  | { readonly status: 'restored' | 'already_restored'; readonly userId: string; readonly credits: number }

export async function restorePlanPaymentReversalInTransaction(
  tx: Prisma.TransactionClient,
  input: Pick<PlanPaymentReversalInput, 'eventId' | 'objectType' | 'objectId'>,
): Promise<RestorePlanPaymentReversalResult> {
  const debitKey = `stripe:${input.objectType}:${input.objectId}:plan:debit`
  const reversal = await tx.balanceTransaction.findFirst({
    where: { type: 'plan_reversal', idempotencyKey: debitKey },
    select: { userId: true, relatedId: true, billingMeta: true },
  })
  if (!reversal) return { status: 'not_plan_reversal' }
  const stored = parseStoredReversal(reversal)
  await lockUser(tx, stored.userId)

  const restoreKey = `stripe:${input.objectType}:${input.objectId}:plan:restore`
  const existing = await tx.balanceTransaction.findFirst({
    where: { userId: stored.userId, type: 'plan_reversal_restore', idempotencyKey: restoreKey },
    select: { id: true },
  })
  if (existing) {
    return {
      status: 'already_restored',
      userId: stored.userId,
      credits: stored.before.subscriptionCredits - stored.afterSubscriptionCredits,
    }
  }

  const purchase = await tx.balanceTransaction.findUnique({
    where: { id: stored.purchaseTransactionId },
    select: { relatedId: true },
  })
  if (!purchase?.relatedId) throw new Error('PLAN_REVERSAL_RESTORE_PURCHASE_NOT_FOUND')
  const subscription = await tx.subscription.findUnique({ where: { id: purchase.relatedId } })
  if (!subscription) throw new Error('PLAN_REVERSAL_RESTORE_SUBSCRIPTION_NOT_FOUND')
  const balance = await lockSubscriptionBalanceInTransaction(tx, stored.userId)
  if (
    subscription.planId !== stored.afterTerm.planId
    || subscription.interval !== stored.afterTerm.interval
    || subscription.status !== stored.afterTerm.status
    || subscription.currentTermKey !== stored.afterTerm.termKey
    || subscription.currentPeriodStart.getTime() !== stored.afterTerm.startsAt.getTime()
    || subscription.currentPeriodEnd.getTime() !== stored.afterTerm.endsAt.getTime()
  ) {
    throw new Error('PLAN_REVERSAL_RESTORE_TERM_CHANGED')
  }
  if (
    stored.purchaseMode === 'restart_now_v1'
    && (
      balance.subscriptionCredits !== stored.afterSubscriptionCredits
      || balance.subscriptionExpiresAt?.getTime()
        !== stored.afterSubscriptionExpiresAt?.getTime()
    )
  ) {
    throw new Error('PLAN_REVERSAL_RESTORE_BALANCE_CHANGED')
  }

  await tx.subscription.update({
    where: { id: subscription.id },
    data: {
      planId: stored.before.planId,
      interval: stored.before.interval,
      status: stored.before.status,
      currentTermKey: stored.before.termKey,
      currentPeriodStart: stored.before.startsAt,
      currentPeriodEnd: stored.before.endsAt,
    },
  })
  if (stored.purchaseMode === 'restart_now_v1') {
    await tx.userBalance.update({
      where: { userId: stored.userId },
      data: {
        subscriptionCredits: stored.before.subscriptionCredits,
        subscriptionExpiresAt: stored.before.subscriptionExpiresAt,
      },
    })
  }
  await tx.balanceTransaction.create({
    data: {
      userId: stored.userId,
      type: 'plan_reversal_restore',
      amount: 0,
      balanceAfter: balance.balance,
      description: `[PLAN ${input.objectType.toUpperCase()} RESTORE]`,
      relatedId: reversal.relatedId,
      externalOrderId: `stripe:${input.objectType}:${input.objectId}`,
      idempotencyKey: restoreKey,
      billingMeta: JSON.stringify({
        provider: 'stripe',
        eventId: input.eventId,
        objectType: input.objectType,
        objectId: input.objectId,
      }),
    },
  })
  return {
    status: 'restored',
    userId: stored.userId,
    credits: stored.before.subscriptionCredits - stored.afterSubscriptionCredits,
  }
}
