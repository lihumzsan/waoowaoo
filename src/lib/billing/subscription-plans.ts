import { CREDITS_PER_CNY } from './credits'
import type { WorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'

/**
 * The production subscription catalog.
 *
 * This is the single authoritative declaration of what a plan costs, how many
 * credits it grants per period, and what execution capacity it unlocks. Prices
 * and grants are declared as literals rather than derived from a bonus rate:
 * the round numbers are the product decision, and the implied bonus is derived
 * from them for display only.
 */

export type SubscriptionPlanId = 'starter' | 'creator' | 'pro' | 'studio' | 'flagship'

export type SubscriptionInterval = 'month' | 'year'

/** Months billed in one payment for each interval. */
export const SUBSCRIPTION_INTERVAL_MONTHS: Record<SubscriptionInterval, number> = {
  month: 1,
  year: 12,
}

/**
 * Months actually charged on a yearly plan. Two months are free, which is the
 * only discount a yearly commitment carries — the credit grant per month is
 * identical to the monthly plan.
 */
const YEARLY_BILLED_MONTHS = 10

export interface SubscriptionPlanDefinition {
  readonly id: SubscriptionPlanId
  /** Monthly list price in CNY. */
  readonly monthlyPriceCny: number
  /** Credits granted at the start of every month, on both intervals. */
  readonly monthlyCredits: number
  /** Per-user execution capacity unlocked by this plan. */
  readonly concurrency: WorkflowConcurrencyConfig
  /** Marks the plan the pricing page leads with. */
  readonly featured: boolean
  /**
   * First-period promotional price in CNY, monthly interval only. Applied by
   * Stripe as a first-invoice discount; it never changes the credit grant.
   */
  readonly firstMonthPromoCny: number | null
}

/**
 * Capacity unlocked without any subscription. Also the floor every plan
 * inherits, so a lapsed subscription degrades to this rather than to zero.
 */
export const FREE_TIER_CONCURRENCY: WorkflowConcurrencyConfig = {
  analysis: 2,
  image: 2,
  video: 2,
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanDefinition[] = [
  {
    id: 'starter',
    monthlyPriceCny: 99,
    monthlyCredits: 1_040,
    concurrency: { analysis: 3, image: 2, video: 2 },
    featured: false,
    firstMonthPromoCny: null,
  },
  {
    id: 'creator',
    monthlyPriceCny: 499,
    monthlyCredits: 5_600,
    concurrency: { analysis: 5, image: 6, video: 6 },
    featured: true,
    firstMonthPromoCny: 399,
  },
  {
    id: 'pro',
    monthlyPriceCny: 1_599,
    monthlyCredits: 18_400,
    concurrency: { analysis: 8, image: 10, video: 10 },
    featured: false,
    firstMonthPromoCny: null,
  },
  {
    id: 'studio',
    monthlyPriceCny: 3_999,
    monthlyCredits: 48_000,
    concurrency: { analysis: 12, image: 16, video: 16 },
    featured: false,
    firstMonthPromoCny: null,
  },
  {
    id: 'flagship',
    monthlyPriceCny: 8_999,
    monthlyCredits: 112_500,
    concurrency: { analysis: 16, image: 24, video: 24 },
    featured: false,
    firstMonthPromoCny: null,
  },
]

const PLANS_BY_ID = new Map<SubscriptionPlanId, SubscriptionPlanDefinition>(
  SUBSCRIPTION_PLANS.map((plan) => [plan.id, plan]),
)

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return typeof value === 'string' && PLANS_BY_ID.has(value as SubscriptionPlanId)
}

export function getSubscriptionPlan(id: SubscriptionPlanId): SubscriptionPlanDefinition {
  const plan = PLANS_BY_ID.get(id)
  if (!plan) throw new Error(`SUBSCRIPTION_PLAN_UNKNOWN: ${id}`)
  return plan
}

export function isSubscriptionInterval(value: unknown): value is SubscriptionInterval {
  return value === 'month' || value === 'year'
}

/** Amount charged in one billing cycle, in CNY. */
export function subscriptionPeriodPriceCny(
  plan: SubscriptionPlanDefinition,
  interval: SubscriptionInterval,
): number {
  return interval === 'year'
    ? plan.monthlyPriceCny * YEARLY_BILLED_MONTHS
    : plan.monthlyPriceCny
}

/** Total credits a full billing cycle eventually grants, across all its months. */
export function subscriptionPeriodTotalCredits(
  plan: SubscriptionPlanDefinition,
  interval: SubscriptionInterval,
): number {
  return plan.monthlyCredits * SUBSCRIPTION_INTERVAL_MONTHS[interval]
}

/**
 * Credits per CNY actually received on this plan, relative to the face rate of
 * `CREDITS_PER_CNY`. Used for display ("+12%") and by the margin guard, which
 * prices every model against the cheapest credit any plan can produce.
 */
export function subscriptionBonusRate(
  plan: SubscriptionPlanDefinition,
  interval: SubscriptionInterval,
): number {
  const paidCny = subscriptionPeriodPriceCny(plan, interval)
  const faceCredits = paidCny * CREDITS_PER_CNY
  return subscriptionPeriodTotalCredits(plan, interval) / faceCredits - 1
}

/** Effective CNY paid per credit on this plan. Lower means a deeper discount. */
export function subscriptionEffectiveCreditPriceCny(
  plan: SubscriptionPlanDefinition,
  interval: SubscriptionInterval,
): number {
  return subscriptionPeriodPriceCny(plan, interval) / subscriptionPeriodTotalCredits(plan, interval)
}

/**
 * The cheapest CNY any credit in the system can be bought for, across every
 * plan and interval. Every retail price must stay profitable at this rate —
 * see `assertPricingMargins`.
 */
export function minimumEffectiveCreditPriceCny(): number {
  let cheapest = 1 / CREDITS_PER_CNY
  for (const plan of SUBSCRIPTION_PLANS) {
    for (const interval of ['month', 'year'] as const) {
      const price = subscriptionEffectiveCreditPriceCny(plan, interval)
      if (price < cheapest) cheapest = price
    }
  }
  return cheapest
}
