import { prisma } from '@/lib/prisma'
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

/**
 * Statuses in which a plan term still grants credits.
 *
 * A term is bought outright, so there is no dunning or grace period to model:
 * it is either paid up or it has run out. `currentPeriodEnd` is what actually
 * stops the grants; this status is the coarse flag alongside it.
 */
const GRANTING_STATUSES: ReadonlySet<string> = new Set(['active'])

export function isGrantingPlanTermStatus(status: string): boolean {
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
 * The index is monotonic inside one paid term. A yearly term pays once and
 * grants twelve times; a later payment receives a new `currentTermKey` and
 * starts again at period zero without colliding with the previous term.
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
  readonly currentPeriodStart: Date
  readonly currentPeriodEnd: Date
  readonly currentTermKey: string
  readonly grantsCredits: boolean
}

type SubscriptionRow = {
  id: string
  userId: string
  planId: string
  interval: string
  status: string
  currentPeriodStart: Date
  currentPeriodEnd: Date
  currentTermKey: string
}

export function toSubscriptionSnapshot(row: SubscriptionRow): SubscriptionSnapshot | null {
  if (!isSubscriptionPlanId(row.planId) || !isSubscriptionInterval(row.interval)) return null
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    interval: row.interval,
    status: row.status,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    currentTermKey: row.currentTermKey,
    grantsCredits: isGrantingPlanTermStatus(row.status),
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
  if (!isGrantingPlanTermStatus(subscription.status)) return { status: 'not_granting' }
  if (!isSubscriptionPlanId(subscription.planId)) {
    throw new Error(`SUBSCRIPTION_PLAN_UNKNOWN: ${subscription.planId}`)
  }

  const plan = getSubscriptionPlan(subscription.planId)
  const periodIndex = resolvePeriodIndex(subscription.currentPeriodStart, now)
  const expiresAt = addMonths(subscription.currentPeriodStart, periodIndex + 1)

  // Grants stop at the boundary of this paid term. A later payment starts a
  // different term identity instead of extending this one.
  if (expiresAt.getTime() > subscription.currentPeriodEnd.getTime()) {
    return { status: 'not_granting' }
  }

  const result = await prisma.$transaction(async (tx) => grantSubscriptionPeriodInTransaction(tx, {
    subscriptionId: subscription.id,
    userId,
    planId: plan.id,
    termKey: subscription.currentTermKey,
    periodIndex,
    credits: plan.monthlyCredits,
    expiresAt,
    grantedAt: now,
  }))

  return { status: result.status === 'granted' ? 'granted' : 'already_granted' }
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
