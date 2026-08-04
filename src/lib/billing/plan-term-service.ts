import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import {
  getSubscriptionPlan,
  SUBSCRIPTION_INTERVAL_MONTHS,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from './subscription-plans'
import {
  addMonths,
  resolvePeriodIndex,
  topUpCurrentPeriodForPlanChange,
} from './subscription-service'

const planTermLogger = createScopedLogger({ module: 'billing.plan-term' })

/**
 * Applying a paid plan term.
 *
 * A purchase either starts a term or extends the one already running. Extending
 * matters: someone who buys a second month before the first ends should get two
 * months, not have the remainder thrown away — and the monthly grant counter
 * has to keep running from the original start so periods never repeat.
 */

export interface ApplyPlanPurchaseInput {
  readonly userId: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
  /** Checkout session id — the identity that makes replaying the webhook safe. */
  readonly purchaseId: string
}

export type ApplyPlanPurchaseResult =
  | { readonly status: 'applied'; readonly grantedCredits: number; readonly endsAt: Date }
  | { readonly status: 'already_applied' }

export async function applyPlanPurchaseInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyPlanPurchaseInput,
): Promise<ApplyPlanPurchaseResult> {
  const idempotencyKey = `stripe:plan:${input.purchaseId}`
  const existing = await tx.balanceTransaction.findFirst({
    where: { userId: input.userId, type: 'plan_purchase', idempotencyKey },
    select: { id: true },
  })
  if (existing) return { status: 'already_applied' }

  const plan = getSubscriptionPlan(input.planId)
  const months = SUBSCRIPTION_INTERVAL_MONTHS[input.interval]
  const now = new Date()
  const current = await tx.subscription.findUnique({ where: { userId: input.userId } })

  // Extend from whichever is later: an unfinished term keeps its remaining
  // time, an expired one restarts from today.
  const extendFrom = current && current.currentPeriodEnd.getTime() > now.getTime()
    ? current.currentPeriodEnd
    : now
  const endsAt = addMonths(extendFrom, months)
  // A running term keeps its original start so `periodIndex` stays monotonic;
  // a lapsed one starts counting again from today.
  const startsAt = current && current.currentPeriodEnd.getTime() > now.getTime()
    ? current.currentPeriodStart
    : now

  const term = await tx.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      planId: plan.id,
      interval: input.interval,
      status: 'active',
      currentPeriodStart: startsAt,
      currentPeriodEnd: endsAt,
    },
    update: {
      planId: plan.id,
      interval: input.interval,
      status: 'active',
      currentPeriodStart: startsAt,
      currentPeriodEnd: endsAt,
    },
  })

  await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      type: 'plan_purchase',
      // The purchase grants credits to the subscription pool rather than
      // moving the spendable balance, so like every other grant row this
      // carries zero and keeps the detail in billingMeta.
      amount: 0,
      balanceAfter: 0,
      description: `[PLAN] ${plan.id} ${input.interval}`,
      relatedId: term.id,
      externalOrderId: input.purchaseId,
      idempotencyKey,
      billingMeta: JSON.stringify({
        planId: plan.id,
        interval: input.interval,
        months,
        monthlyCredits: plan.monthlyCredits,
        termStartsAt: startsAt.toISOString(),
        termEndsAt: endsAt.toISOString(),
      }),
    },
  })

  // Buying while a term is already running is an upgrade if the new plan grants
  // more: the current month is topped up to the difference rather than granted
  // twice, and buying a smaller plan adds nothing to a month already granted.
  const periodIndex = resolvePeriodIndex(term.currentPeriodStart, now)
  const granted = await topUpCurrentPeriodForPlanChange(tx, {
    subscriptionId: term.id,
    userId: input.userId,
    nextPlanId: plan.id,
    periodIndex,
    expiresAt: addMonths(term.currentPeriodStart, periodIndex + 1),
  })

  planTermLogger.info({
    audit: true,
    action: 'billing.plan.purchased',
    message: 'plan term purchased',
    userId: input.userId,
    details: {
      planId: plan.id,
      interval: input.interval,
      months,
      periodIndex,
      endsAt: endsAt.toISOString(),
      purchaseId: input.purchaseId,
    },
  })

  return {
    status: 'applied',
    grantedCredits: granted.addedCredits,
    endsAt,
  }
}

export async function applyPlanPurchase(
  input: ApplyPlanPurchaseInput,
): Promise<ApplyPlanPurchaseResult> {
  return prisma.$transaction(async (tx) => applyPlanPurchaseInTransaction(tx, input))
}
