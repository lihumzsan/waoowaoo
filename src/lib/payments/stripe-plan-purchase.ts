import type Stripe from 'stripe'
import { CREDIT_UNIT_CNY } from '@/lib/billing/credits'
import {
  getSubscriptionPlan,
  SUBSCRIPTION_INTERVAL_MONTHS,
  subscriptionPeriodPriceCny,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from '@/lib/billing/subscription-plans'
import { STRIPE_PAYMENT_CURRENCY } from './recharge-config'
import { createStripeClient } from './stripe-client'

/**
 * Buying a plan term.
 *
 * Plans are sold outright rather than subscribed to. WeChat Pay cannot back an
 * automatically renewing charge on Stripe, and Stripe Checkout hides it
 * entirely in subscription mode — so a subscription would be unbuyable for
 * most of these users. A one-off payment accepts every method the account has
 * enabled, WeChat included.
 *
 * What the payment buys is unchanged: a monthly term grants one month of
 * credits, a yearly term grants twelve, released month by month and expiring
 * at the end of each.
 */

export const PLAN_PURCHASE_KIND = 'credit_plan_purchase'

export interface CreatePlanPurchaseInput {
  readonly userId: string
  readonly email?: string | null
  readonly locale: 'zh' | 'en'
  readonly origin: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
}

export interface PlanPurchaseResult {
  readonly id: string
  readonly url: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
  readonly priceCny: number
  readonly monthlyCredits: number
}

function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error('PAYMENT_PUBLIC_ORIGIN_INVALID')
  }
  return trimmed
}

function toMinorUnits(amountCny: number): number {
  const minor = Math.round(amountCny * 100)
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('PAYMENT_AMOUNT_INVALID')
  return minor
}

function getPlanText(
  locale: 'zh' | 'en',
  planId: SubscriptionPlanId,
  interval: SubscriptionInterval,
  monthlyCredits: number,
): { name: string; description: string } {
  const months = SUBSCRIPTION_INTERVAL_MONTHS[interval]
  const monthly = monthlyCredits.toLocaleString('en-US')
  if (locale === 'en') {
    return {
      name: `WaooAI ${planId} plan`,
      description: months === 1
        ? `${monthly} credits for one month`
        : `${monthly} credits a month for ${months} months`,
    }
  }
  return {
    name: `WaooAI ${planId} 套餐`,
    description: months === 1
      ? `${monthly} 额度，有效期 1 个月`
      : `每月 ${monthly} 额度，共 ${months} 个月`,
  }
}

export async function createPlanPurchaseSession(
  input: CreatePlanPurchaseInput,
): Promise<PlanPurchaseResult> {
  const plan = getSubscriptionPlan(input.planId)
  const origin = normalizeOrigin(input.origin)
  const currency = STRIPE_PAYMENT_CURRENCY.toLowerCase()
  const priceCny = subscriptionPeriodPriceCny(plan, input.interval)
  const text = getPlanText(input.locale, plan.id, input.interval, plan.monthlyCredits)

  // The promo is a first-purchase discount on the monthly term, applied to the
  // amount charged. It never changes how many credits the term grants.
  const promoCny = input.interval === 'month' ? plan.firstMonthPromoCny : null
  const chargedCny = promoCny ?? priceCny

  const metadata: Stripe.MetadataParam = {
    waoowaoo_kind: PLAN_PURCHASE_KIND,
    user_id: input.userId,
    plan_id: plan.id,
    plan_interval: input.interval,
    monthly_credits: String(plan.monthlyCredits),
    credit_unit_cny: String(CREDIT_UNIT_CNY),
    list_price_cny: priceCny.toFixed(2),
    payment_amount: chargedCny.toFixed(2),
    payment_currency: currency,
  }

  const session = await createStripeClient().checkout.sessions.create({
    // A one-off payment, so every method the account has enabled is offered —
    // including WeChat Pay, which subscription mode would have hidden.
    mode: 'payment',
    success_url: `${origin}/${input.locale}/profile?section=billing&plan=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/${input.locale}/profile?section=billing&plan=cancel`,
    client_reference_id: input.userId,
    ...(input.email ? { customer_email: input.email } : {}),
    line_items: [{
      quantity: 1,
      price_data: {
        currency,
        unit_amount: toMinorUnits(chargedCny),
        product_data: {
          name: text.name,
          description: text.description,
        },
      },
    }],
    metadata,
    payment_intent_data: { metadata },
  })

  if (!session.url) throw new Error('STRIPE_CHECKOUT_RESPONSE_MISSING_URL')
  return {
    id: session.id,
    url: session.url,
    planId: plan.id,
    interval: input.interval,
    priceCny: chargedCny,
    monthlyCredits: plan.monthlyCredits,
  }
}
