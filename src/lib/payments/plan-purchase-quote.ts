import { prisma } from '@/lib/prisma'
import {
  getSubscriptionPlan,
  isSubscriptionPlanId,
  subscriptionPeriodPriceCny,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from '@/lib/billing/subscription-plans'
import { STRIPE_PAYMENT_CURRENCY } from './recharge-config'

export const PLAN_PURCHASE_QUOTE_VERSION = 'restart_now_v1'

export interface PlanPurchaseQuote {
  readonly version: typeof PLAN_PURCHASE_QUOTE_VERSION
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
  readonly monthlyCredits: number
  readonly listPriceCny: number
  readonly amountCny: number
  readonly amountMinor: number
  readonly currency: string
  readonly promotionApplied: boolean
  readonly action: 'start' | 'restart'
}

/**
 * The only quote used by card and WeChat plan checkout.
 *
 * A successful historical plan purchase consumes the first-purchase promotion;
 * current balance and prior usage never alter the price of the new full term.
 */
export async function quotePlanPurchase(input: {
  userId: string
  planId: SubscriptionPlanId
  interval: SubscriptionInterval
}): Promise<PlanPurchaseQuote> {
  const plan = getSubscriptionPlan(input.planId)
  const listPriceCny = subscriptionPeriodPriceCny(plan, input.interval)
  const [priorPurchaseCount, current] = await Promise.all([
    prisma.balanceTransaction.count({ where: { userId: input.userId, type: 'plan_purchase' } }),
    prisma.subscription.findUnique({ where: { userId: input.userId } }),
  ])
  const now = new Date()
  const active = current?.status === 'active' && current.currentPeriodEnd.getTime() > now.getTime()
    ? current
    : null
  if (active?.interval === 'year') {
    throw new Error('PLAN_PURCHASE_ACTIVE_YEAR_TERM_UNSUPPORTED')
  }
  if (active && !isSubscriptionPlanId(active.planId)) {
    throw new Error('SUBSCRIPTION_PLAN_UNKNOWN')
  }
  const activePlan = active && isSubscriptionPlanId(active.planId)
    ? getSubscriptionPlan(active.planId)
    : null
  if (
    activePlan
    && activePlan.monthlyCredits > plan.monthlyCredits
  ) {
    throw new Error('PLAN_PURCHASE_DOWNGRADE_REQUIRES_TERM_END')
  }
  const promotionApplied = input.interval === 'month'
    && plan.firstMonthPromoCny !== null
    && priorPurchaseCount === 0
  const amountCny = promotionApplied && plan.firstMonthPromoCny !== null
    ? plan.firstMonthPromoCny
    : listPriceCny
  const amountMinor = Math.round(amountCny * 100)
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('PAYMENT_AMOUNT_INVALID')
  }

  return {
    version: PLAN_PURCHASE_QUOTE_VERSION,
    planId: plan.id,
    interval: input.interval,
    monthlyCredits: plan.monthlyCredits,
    listPriceCny,
    amountCny,
    amountMinor,
    currency: STRIPE_PAYMENT_CURRENCY.toLowerCase(),
    promotionApplied,
    action: active ? 'restart' : 'start',
  }
}
