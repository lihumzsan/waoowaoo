import { CREDITS_PER_CNY } from './credits'

/**
 * The production subscription catalog.
 *
 * This is the single authoritative declaration of what a plan costs, how many
 * credits it grants per period, and what execution capacity it unlocks. Prices
 * and grants are declared as literals rather than derived from a bonus rate:
 * the round numbers are the product decision, and the implied bonus is derived
 * from them for display only.
 *
 * The grants encode a deliberate markup ladder, read against the markups in
 * `pricing-retail.ts`: credits bought outright carry +80% over provider cost,
 * the entry plan +71%, and the deepest discount available anywhere — flagship
 * on the yearly term — bottoms out at +30%. A grant edited on its own silently
 * moves that plan's markup, so any change here belongs with a recomputed ladder
 * rather than a single number.
 */

export type SubscriptionPlanId = 'lite' | 'starter' | 'creator' | 'pro' | 'studio' | 'flagship'

export type SubscriptionInterval = 'month' | 'year'

/** Months billed in one payment for each interval. */
export const SUBSCRIPTION_INTERVAL_MONTHS: Record<SubscriptionInterval, number> = {
  month: 1,
  year: 12,
}

export interface SubscriptionPlanDefinition {
  readonly id: SubscriptionPlanId
  /** Monthly list price in CNY. */
  readonly monthlyPriceCny: number
  /**
   * Yearly list price in CNY, declared rather than derived.
   *
   * A yearly price is a price, not the output of a formula: it is set to a
   * round figure roughly ten months' worth, so the page shows ¥15,900 instead
   * of whatever `monthlyPrice * 10` happens to produce.
   */
  readonly yearlyPriceCny: number
  /** Credits granted at the start of every month, on both intervals. */
  readonly monthlyCredits: number
  /** Marks the plan the pricing page leads with. */
  readonly featured: boolean
  /**
   * First-period promotional price in CNY, monthly interval only. Applied by
   * Stripe as a first-invoice discount; it never changes the credit grant.
   */
  readonly firstMonthPromoCny: number | null
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanDefinition[] = [
  {
    id: 'lite',
    monthlyPriceCny: 79,
    yearlyPriceCny: 790,
    monthlyCredits: 800,
    featured: false,
    firstMonthPromoCny: null,
  },
  {
    id: 'starter',
    monthlyPriceCny: 199,
    yearlyPriceCny: 1_990,
    monthlyCredits: 2_100,
    featured: false,
    firstMonthPromoCny: null,
  },
  {
    id: 'creator',
    monthlyPriceCny: 499,
    yearlyPriceCny: 4_990,
    monthlyCredits: 5_450,
    featured: true,
    firstMonthPromoCny: 399,
  },
  {
    id: 'pro',
    monthlyPriceCny: 1_599,
    yearlyPriceCny: 15_900,
    monthlyCredits: 17_800,
    featured: false,
    firstMonthPromoCny: null,
  },
  {
    id: 'studio',
    monthlyPriceCny: 3_999,
    yearlyPriceCny: 39_900,
    monthlyCredits: 45_300,
    featured: false,
    firstMonthPromoCny: null,
  },
  {
    id: 'flagship',
    monthlyPriceCny: 8_999,
    yearlyPriceCny: 89_900,
    monthlyCredits: 104_000,
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
  return interval === 'year' ? plan.yearlyPriceCny : plan.monthlyPriceCny
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
