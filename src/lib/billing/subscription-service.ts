import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import {
  expireSubscriptionPoolInTransaction,
  grantSubscriptionPeriodInTransaction,
} from './subscription-ledger'
import {
  getSubscriptionPlan,
  isSubscriptionInterval,
  isSubscriptionPlanId,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from './subscription-plans'

const subscriptionLogger = createScopedLogger({ module: 'billing.subscription' })

/**
 * Statuses in which a subscription still grants credits. Stripe owns the
 * status; this list is only our reading of which of them are "paid up".
 * `past_due` keeps granting on purpose — that is the grace period, and Stripe
 * moves the subscription to `unpaid`/`canceled` when retries are exhausted.
 */
const GRANTING_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due'])

export function isGrantingSubscriptionStatus(status: string): boolean {
  return GRANTING_STATUSES.has(status)
}

/**
 * Add whole months to a date, clamping the day so month lengths do not shift
 * an anchor. A subscription anchored on the 31st bills on the 30th in a
 * 30-day month and must not drift to the 1st of the next one.
 */
export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime())
  const targetDay = from.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const daysInTargetMonth = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0,
  )).getUTCDate()
  result.setUTCDate(Math.min(targetDay, daysInTargetMonth))
  return result
}

/**
 * Which monthly period a subscription is in, counted from its anchor.
 *
 * The index is monotonic across renewals and plan changes, which is what makes
 * it usable as a grant identity: a yearly term pays once and grants twelve
 * times, and a monthly term simply keeps counting.
 */
export function resolvePeriodIndex(anchorAt: Date, now: Date): number {
  if (now.getTime() <= anchorAt.getTime()) return 0
  let index = 0
  // Step forward rather than deriving from a month difference, so the same
  // day-clamping rule decides both the index and the expiry.
  while (addMonths(anchorAt, index + 1).getTime() <= now.getTime()) {
    index += 1
    if (index > 600) break
  }
  return index
}

export interface SubscriptionSnapshot {
  readonly id: string
  readonly userId: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
  readonly status: string
  readonly cancelAtPeriodEnd: boolean
  readonly currentPeriodEnd: Date
  readonly grantsCredits: boolean
}

type SubscriptionRow = {
  id: string
  userId: string
  planId: string
  interval: string
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date
  createdAt: Date
}

export function toSubscriptionSnapshot(row: SubscriptionRow): SubscriptionSnapshot | null {
  if (!isSubscriptionPlanId(row.planId) || !isSubscriptionInterval(row.interval)) return null
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    interval: row.interval,
    status: row.status,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodEnd: row.currentPeriodEnd,
    grantsCredits: isGrantingSubscriptionStatus(row.status),
  }
}

/**
 * Grant the current month if it has not been granted yet.
 *
 * Idempotent by grant identity, so it is safe to call from anywhere: the
 * scheduled sweep drives it normally, and the balance read and task-submission
 * gate call it too, which means a user who comes back after the sweep failed
 * still gets the month they paid for. Nothing here depends on a timer having
 * fired on time.
 */
export async function ensureCurrentPeriodGranted(
  userId: string,
  now: Date = new Date(),
): Promise<{ status: 'granted' | 'already_granted' | 'no_subscription' | 'not_granting' }> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } })
  if (!subscription) return { status: 'no_subscription' }
  if (!isGrantingSubscriptionStatus(subscription.status)) return { status: 'not_granting' }
  if (!isSubscriptionPlanId(subscription.planId)) {
    throw new Error(`SUBSCRIPTION_PLAN_UNKNOWN: ${subscription.planId}`)
  }

  const plan = getSubscriptionPlan(subscription.planId)
  const periodIndex = resolvePeriodIndex(subscription.createdAt, now)
  const expiresAt = addMonths(subscription.createdAt, periodIndex + 1)

  // A term that has run past what was paid for stops granting. Stripe will
  // either renew it (advancing currentPeriodEnd) or end it.
  if (expiresAt.getTime() > subscription.currentPeriodEnd.getTime()) {
    return { status: 'not_granting' }
  }

  const result = await prisma.$transaction(async (tx) => grantSubscriptionPeriodInTransaction(tx, {
    subscriptionId: subscription.id,
    userId,
    planId: plan.id,
    periodIndex,
    credits: plan.monthlyCredits,
    expiresAt,
  }))

  return { status: result.status === 'granted' ? 'granted' : 'already_granted' }
}

/**
 * Top up the current period after an immediate upgrade.
 *
 * An upgrade takes effect at once, so the user gets the difference between the
 * new plan's monthly grant and what this period already granted. Credits
 * already spent are not clawed back, and a downgrade adds nothing — it takes
 * effect when the period ends, so this returns zero rather than a negative.
 */
export async function topUpCurrentPeriodForPlanChange(
  tx: Prisma.TransactionClient,
  input: {
    subscriptionId: string
    userId: string
    nextPlanId: SubscriptionPlanId
    periodIndex: number
    expiresAt: Date
  },
): Promise<{ addedCredits: number }> {
  const plan = getSubscriptionPlan(input.nextPlanId)
  const existing = await tx.subscriptionGrant.findUnique({
    where: {
      subscriptionId_periodIndex: {
        subscriptionId: input.subscriptionId,
        periodIndex: input.periodIndex,
      },
    },
  })
  if (!existing) {
    await grantSubscriptionPeriodInTransaction(tx, {
      subscriptionId: input.subscriptionId,
      userId: input.userId,
      planId: plan.id,
      periodIndex: input.periodIndex,
      credits: plan.monthlyCredits,
      expiresAt: input.expiresAt,
    })
    return { addedCredits: plan.monthlyCredits }
  }

  const delta = plan.monthlyCredits - existing.credits
  if (delta <= 0) return { addedCredits: 0 }

  await tx.userBalance.update({
    where: { userId: input.userId },
    data: { subscriptionCredits: { increment: delta } },
  })
  await tx.subscriptionGrant.update({
    where: { id: existing.id },
    data: { credits: plan.monthlyCredits, planId: plan.id },
  })
  await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      type: 'subscription_grant',
      amount: 0,
      balanceAfter: 0,
      description: `[UPGRADE] ${plan.id} period ${input.periodIndex}`,
      relatedId: input.subscriptionId,
      idempotencyKey: `subscription:${input.subscriptionId}:${input.periodIndex}:upgrade:${plan.id}`,
      billingMeta: JSON.stringify({
        planId: plan.id,
        periodIndex: input.periodIndex,
        addedCredits: delta,
        previousCredits: existing.credits,
      }),
    },
  })

  subscriptionLogger.info({
    audit: true,
    action: 'billing.subscription.upgraded',
    message: 'subscription upgrade topped up current period',
    userId: input.userId,
    details: {
      subscriptionId: input.subscriptionId,
      planId: plan.id,
      periodIndex: input.periodIndex,
      addedCredits: delta,
    },
  })

  return { addedCredits: delta }
}

/** End a subscription: stop granting and clear whatever the pool still holds. */
export async function endSubscription(
  userId: string,
  reason: string,
): Promise<{ forfeitedCredits: number }> {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({ where: { userId } })
    if (!subscription) return { forfeitedCredits: 0 }
    return expireSubscriptionPoolInTransaction(tx, {
      userId,
      subscriptionId: subscription.id,
      reason,
    })
  })
}

export async function getSubscriptionSnapshot(userId: string): Promise<SubscriptionSnapshot | null> {
  const row = await prisma.subscription.findUnique({ where: { userId } })
  return row ? toSubscriptionSnapshot(row) : null
}
