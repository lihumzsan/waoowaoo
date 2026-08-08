import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import {
  getSubscriptionPlan,
  SUBSCRIPTION_INTERVAL_MONTHS,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from './subscription-plans'
import { startSubscriptionTermInTransaction } from './subscription-ledger'
import { addMonths } from './subscription-service'

const planTermLogger = createScopedLogger({ module: 'billing.plan-term' })

export interface ApplyPlanPurchaseInput {
  readonly userId: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
  /** Canonical Stripe PaymentIntent identity. */
  readonly purchaseId: string
  /** Checkout session or PaymentIntent that delivered the successful payment. */
  readonly providerObjectId: string
  readonly paidAt: Date
  readonly paymentAmountMinor: number
  readonly paymentCurrency: string
  readonly receiptUrl?: string | null
}

export type ApplyPlanPurchaseResult =
  | {
      readonly status: 'applied'
      readonly grantedCredits: number
      readonly carriedCredits: number
      readonly startsAt: Date
      readonly endsAt: Date
    }
  | { readonly status: 'already_applied' }

async function lockPlanOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM \`user\`
    WHERE id = ${userId}
    FOR UPDATE
  `
  if (!rows[0]) throw new Error('PLAN_PURCHASE_USER_NOT_FOUND')
}

function assertPaymentFacts(input: ApplyPlanPurchaseInput): void {
  if (!input.purchaseId.trim()) throw new Error('PLAN_PURCHASE_ID_REQUIRED')
  if (!input.providerObjectId.trim()) throw new Error('PLAN_PURCHASE_PROVIDER_OBJECT_REQUIRED')
  if (!Number.isSafeInteger(input.paymentAmountMinor) || input.paymentAmountMinor <= 0) {
    throw new Error('PLAN_PURCHASE_PAYMENT_AMOUNT_INVALID')
  }
  if (!input.paymentCurrency.trim()) throw new Error('PLAN_PURCHASE_PAYMENT_CURRENCY_REQUIRED')
  if (!Number.isFinite(input.paidAt.getTime())) throw new Error('PLAN_PURCHASE_PAID_AT_INVALID')
}

/**
 * Apply one successful plan payment.
 *
 * Every payment starts a new term at the provider success time. The still
 * usable subscription pool is carried into the new first-period expiry, then
 * the target plan's complete monthly grant is added. Payment, term projection,
 * grant and balance all commit in this one transaction.
 */
export async function applyPlanPurchaseInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyPlanPurchaseInput,
): Promise<ApplyPlanPurchaseResult> {
  assertPaymentFacts(input)
  await lockPlanOwner(tx, input.userId)

  const idempotencyKey = `stripe:plan:${input.purchaseId}`
  const existing = await tx.balanceTransaction.findFirst({
    where: { userId: input.userId, type: 'plan_purchase', idempotencyKey },
    select: { id: true },
  })
  if (existing) return { status: 'already_applied' }

  const plan = getSubscriptionPlan(input.planId)
  const months = SUBSCRIPTION_INTERVAL_MONTHS[input.interval]
  const startsAt = new Date(input.paidAt.getTime())
  const endsAt = addMonths(startsAt, months)
  const firstGrantExpiresAt = addMonths(startsAt, 1)
  const previous = await tx.subscription.findUnique({ where: { userId: input.userId } })

  const term = await tx.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      planId: plan.id,
      interval: input.interval,
      currentTermKey: input.purchaseId,
      status: 'active',
      currentPeriodStart: startsAt,
      currentPeriodEnd: endsAt,
    },
    update: {
      planId: plan.id,
      interval: input.interval,
      currentTermKey: input.purchaseId,
      status: 'active',
      currentPeriodStart: startsAt,
      currentPeriodEnd: endsAt,
    },
  })

  const granted = await startSubscriptionTermInTransaction(tx, {
    subscriptionId: term.id,
    userId: input.userId,
    planId: plan.id,
    termKey: input.purchaseId,
    credits: plan.monthlyCredits,
    startsAt,
    expiresAt: firstGrantExpiresAt,
  })
  if (granted.status !== 'granted') {
    throw new Error('PLAN_PURCHASE_GRANT_IDENTITY_CONFLICT')
  }

  await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      type: 'plan_purchase',
      amount: 0,
      balanceAfter: 0,
      description: `[PLAN] ${plan.id} ${input.interval}`,
      relatedId: term.id,
      externalOrderId: input.purchaseId,
      idempotencyKey,
      billingMeta: JSON.stringify({
        provider: 'stripe',
        purchaseMode: 'restart_now_v1',
        paymentIntentId: input.purchaseId,
        providerObjectId: input.providerObjectId,
        planId: plan.id,
        interval: input.interval,
        months,
        monthlyCredits: plan.monthlyCredits,
        grantedCredits: granted.credits,
        carriedCredits: granted.carriedCredits,
        paymentAmountMinor: input.paymentAmountMinor,
        paymentCurrency: input.paymentCurrency.toLowerCase(),
        paidAt: startsAt.toISOString(),
        termStartsAt: startsAt.toISOString(),
        termEndsAt: endsAt.toISOString(),
        previousSubscriptionCredits: granted.previousCredits,
        previousSubscriptionExpiresAt: granted.previousExpiresAt?.toISOString() ?? null,
        previousTerm: previous ? {
          planId: previous.planId,
          interval: previous.interval,
          status: previous.status,
          termKey: previous.currentTermKey,
          startsAt: previous.currentPeriodStart.toISOString(),
          endsAt: previous.currentPeriodEnd.toISOString(),
        } : null,
        ...(input.receiptUrl ? { receiptUrl: input.receiptUrl } : {}),
      }),
    },
  })

  planTermLogger.info({
    audit: true,
    action: 'billing.plan.purchased',
    message: 'plan payment started a new term',
    userId: input.userId,
    details: {
      planId: plan.id,
      interval: input.interval,
      termKey: input.purchaseId,
      grantedCredits: granted.credits,
      carriedCredits: granted.carriedCredits,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
  })

  return {
    status: 'applied',
    grantedCredits: granted.credits,
    carriedCredits: granted.carriedCredits,
    startsAt,
    endsAt,
  }
}

export async function applyPlanPurchase(
  input: ApplyPlanPurchaseInput,
): Promise<ApplyPlanPurchaseResult> {
  return prisma.$transaction(async (tx) => applyPlanPurchaseInTransaction(tx, input))
}
