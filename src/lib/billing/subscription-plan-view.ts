import { CREDIT_UNIT_CNY } from './credits'
import {
  FREE_TIER_CONCURRENCY,
  SUBSCRIPTION_PLANS,
  subscriptionBonusRate,
  subscriptionEffectiveCreditPriceCny,
  subscriptionPeriodPriceCny,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from './subscription-plans'
import type { WorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'

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
  /** Cycle price spread over its months — what a plan "costs per month". */
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
  readonly concurrency: WorkflowConcurrencyConfig
  readonly intervals: readonly SubscriptionIntervalView[]
}

export interface SubscriptionCatalogView {
  readonly creditUnitCny: number
  readonly freeConcurrency: WorkflowConcurrencyConfig
  readonly plans: readonly SubscriptionPlanView[]
}

const MONTHS_PER_YEAR = 12

export function buildSubscriptionPlanViews(): SubscriptionCatalogView {
  return {
    creditUnitCny: CREDIT_UNIT_CNY,
    freeConcurrency: FREE_TIER_CONCURRENCY,
    plans: SUBSCRIPTION_PLANS.map((plan) => ({
      id: plan.id,
      monthlyCredits: plan.monthlyCredits,
      featured: plan.featured,
      firstMonthPromoCny: plan.firstMonthPromoCny,
      concurrency: plan.concurrency,
      intervals: (['month', 'year'] as const).map((interval) => {
        const periodPriceCny = subscriptionPeriodPriceCny(plan, interval)
        const months = interval === 'year' ? MONTHS_PER_YEAR : 1
        return {
          interval,
          periodPriceCny,
          monthlyEquivalentCny: Number((periodPriceCny / months).toFixed(2)),
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
