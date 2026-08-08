import { CREDIT_UNIT_CNY } from './credits'
import {
  estimateCreditCapacity,
  resolveCreditCapacityReference,
  type CreditCapacityEstimate,
  type CreditCapacityReference,
} from './subscription-capacity'
import {
  SUBSCRIPTION_PLANS,
  subscriptionBonusRate,
  subscriptionEffectiveCreditPriceCny,
  subscriptionPeriodPriceCny,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from './subscription-plans'

/**
 * The plan catalog as a client can render it.
 *
 * Every number a user sees about a plan is computed here from the same
 * declaration that grants the credits, so the pricing page cannot show a price
 * or bonus the billing side disagrees with.
 */

export interface SubscriptionIntervalView {
  readonly interval: SubscriptionInterval
  /** Amount charged in one cycle. */
  readonly periodPriceCny: number
  /**
   * Cycle price spread over its months, rounded down to a whole yuan.
   *
   * This is a comparison figure, not an amount anyone is charged —
   * `periodPriceCny` is what the card actually bills. Rounding down keeps the
   * headline from advertising a fraction of a yuan and never overstates the
   * price; the exact cycle total is always shown next to it.
   */
  readonly monthlyEquivalentCny: number
  /** Credits per CNY over the face rate, e.g. 0.12 for +12%. */
  readonly bonusRate: number
  readonly effectiveCreditPriceCny: number
  /** Absolute CNY saved per year versus paying monthly. Zero for monthly. */
  readonly savingsVersusMonthlyCny: number
}

export interface SubscriptionPlanView {
  readonly id: SubscriptionPlanId
  readonly monthlyCredits: number
  readonly featured: boolean
  readonly firstMonthPromoCny: number | null
  /** What a month's grant covers, if spent entirely on one kind of work. */
  readonly monthlyCapacity: CreditCapacityEstimate
  readonly intervals: readonly SubscriptionIntervalView[]
}

export interface SubscriptionCatalogView {
  readonly creditUnitCny: number
  /** What one clip and one image cost, so the page can show its maths. */
  readonly capacityReference: CreditCapacityReference
  readonly plans: readonly SubscriptionPlanView[]
}

const MONTHS_PER_YEAR = 12

export function buildSubscriptionPlanViews(): SubscriptionCatalogView {
  const capacityReference = resolveCreditCapacityReference()
  return {
    creditUnitCny: CREDIT_UNIT_CNY,
    capacityReference,
    plans: SUBSCRIPTION_PLANS.map((plan) => ({
      id: plan.id,
      monthlyCredits: plan.monthlyCredits,
      featured: plan.featured,
      firstMonthPromoCny: plan.firstMonthPromoCny,
      monthlyCapacity: estimateCreditCapacity(plan.monthlyCredits, capacityReference),
      intervals: (['month', 'year'] as const).map((interval) => {
        const periodPriceCny = subscriptionPeriodPriceCny(plan, interval)
        const months = interval === 'year' ? MONTHS_PER_YEAR : 1
        return {
          interval,
          periodPriceCny,
          monthlyEquivalentCny: Math.floor(periodPriceCny / months),
          bonusRate: Number(subscriptionBonusRate(plan, interval).toFixed(4)),
          effectiveCreditPriceCny: Number(
            subscriptionEffectiveCreditPriceCny(plan, interval).toFixed(5),
          ),
          savingsVersusMonthlyCny: interval === 'year'
            ? plan.monthlyPriceCny * MONTHS_PER_YEAR - periodPriceCny
            : 0,
        }
      }),
    })),
  }
}
