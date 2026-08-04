import type Stripe from 'stripe'
import { CREDIT_UNIT_CNY } from '@/lib/billing/credits'
import {
  getSubscriptionPlan,
  subscriptionPeriodPriceCny,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from '@/lib/billing/subscription-plans'
import { STRIPE_PAYMENT_CURRENCY } from './recharge-config'
import { createStripeClient } from './stripe-client'

/**
 * Subscription Checkout.
 *
 * Kept separate from the one-off recharge session because the two differ in
 * every load-bearing way: mode, recurring price, where metadata has to live
 * (`subscription_data`, since `payment_intent_data` is rejected in
 * subscription mode), and what the webhook does with the result. Sharing one
 * function would mean a mode flag threaded through all of it.
 */

export interface CreateSubscriptionCheckoutInput {
  readonly userId: string
  readonly email?: string | null
  readonly locale: 'zh' | 'en'
  readonly origin: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
}

export interface SubscriptionCheckoutResult {
  readonly id: string
  readonly url: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
  readonly periodPriceCny: number
  readonly monthlyCredits: number
}

/** Marks a Checkout session and subscription as ours, and says which plan. */
export const SUBSCRIPTION_CHECKOUT_KIND = 'credit_subscription'

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
  const monthlyLabel = monthlyCredits.toLocaleString('en-US')
  if (locale === 'en') {
    return {
      name: `WaooAI ${planId} plan`,
      description: interval === 'year'
        ? `${monthlyLabel} credits every month, billed yearly`
        : `${monthlyLabel} credits every month`,
    }
  }
  return {
    name: `WaooAI ${planId} 套餐`,
    description: interval === 'year'
      ? `每月 ${monthlyLabel} 额度，按年支付`
      : `每月 ${monthlyLabel} 额度`,
  }
}

export async function createSubscriptionCheckoutSession(
  input: CreateSubscriptionCheckoutInput,
): Promise<SubscriptionCheckoutResult> {
  const plan = getSubscriptionPlan(input.planId)
  const origin = normalizeOrigin(input.origin)
  const periodPriceCny = subscriptionPeriodPriceCny(plan, input.interval)
  const currency = STRIPE_PAYMENT_CURRENCY.toLowerCase()
  const text = getPlanText(input.locale, plan.id, input.interval, plan.monthlyCredits)

  const metadata: Stripe.MetadataParam = {
    waoowaoo_kind: SUBSCRIPTION_CHECKOUT_KIND,
    user_id: input.userId,
    plan_id: plan.id,
    plan_interval: input.interval,
    monthly_credits: String(plan.monthlyCredits),
    credit_unit_cny: String(CREDIT_UNIT_CNY),
    period_price_cny: periodPriceCny.toFixed(2),
    payment_currency: currency,
  }

  // The promo is a first-invoice discount, never a change to the credit grant:
  // a cheaper first month still grants exactly one month of credits.
  const promoCny = input.interval === 'month' ? plan.firstMonthPromoCny : null
  const discounts = promoCny === null
    ? undefined
    : [{
        coupon: await resolveFirstPeriodCoupon({
          planId: plan.id,
          currency,
          amountOffMinor: toMinorUnits(plan.monthlyPriceCny - promoCny),
        }),
      }]

  const session = await createStripeClient().checkout.sessions.create({
    mode: 'subscription',
    success_url: `${origin}/${input.locale}/profile?section=billing&subscription=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/${input.locale}/profile?section=billing&subscription=cancel`,
    client_reference_id: input.userId,
    ...(input.email ? { customer_email: input.email } : {}),
    line_items: [{
      quantity: 1,
      price_data: {
        currency,
        unit_amount: toMinorUnits(periodPriceCny),
        recurring: {
          interval: input.interval,
          interval_count: 1,
        },
        product_data: {
          name: text.name,
          description: text.description,
        },
      },
    }],
    ...(discounts ? { discounts } : {}),
    metadata,
    // Subscription mode rejects `payment_intent_data`; the subscription object
    // carries the metadata forward to every renewal invoice instead.
    subscription_data: { metadata },
  })

  if (!session.url) throw new Error('STRIPE_CHECKOUT_RESPONSE_MISSING_URL')
  return {
    id: session.id,
    url: session.url,
    planId: plan.id,
    interval: input.interval,
    periodPriceCny,
    monthlyCredits: plan.monthlyCredits,
  }
}

/**
 * A once-only coupon for the first billing period.
 *
 * Created with a deterministic id so repeated checkouts reuse the same coupon
 * rather than accumulating one per session.
 */
async function resolveFirstPeriodCoupon(input: {
  planId: SubscriptionPlanId
  currency: string
  amountOffMinor: number
}): Promise<string> {
  const client = createStripeClient()
  const couponId = `waoo-first-month-${input.planId}-${input.amountOffMinor}`
  try {
    const existing = await client.coupons.retrieve(couponId)
    if (!existing.deleted) return existing.id
  } catch {
    // Falls through to creation: a missing coupon is the expected first case,
    // and any other failure surfaces from the create call below.
  }
  const created = await client.coupons.create({
    id: couponId,
    amount_off: input.amountOffMinor,
    currency: input.currency,
    duration: 'once',
    name: `First period discount (${input.planId})`,
  })
  return created.id
}
