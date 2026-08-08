import type Stripe from 'stripe'
import { CREDIT_UNIT_CNY } from '@/lib/billing/credits'
import {
  getSubscriptionPlan,
  SUBSCRIPTION_INTERVAL_MONTHS,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from '@/lib/billing/subscription-plans'
import { createStripeClient } from './stripe-client'
import { quotePlanPurchase } from './plan-purchase-quote'
import { admitPaidBetaPayment } from './paid-beta-admission'
import {
  attachPaidBetaProviderObject,
  failPaidBetaPaymentAttempt,
  PAID_BETA_ATTEMPT_METADATA_KEY,
  PAID_BETA_SEAT_METADATA_KEY,
} from '@/lib/paid-beta/campaign'

/**
 * Buying a plan term.
 *
 * Plans are sold outright rather than subscribed to. WeChat Pay is handled by
 * the dedicated QR flow; this Stripe Checkout entry is intentionally card-only
 * so its provider behavior matches the payment-method choice shown in our UI.
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
  const quote = await quotePlanPurchase(input)
  const text = getPlanText(input.locale, plan.id, input.interval, plan.monthlyCredits)
  const attempt = await admitPaidBetaPayment({
    userId: input.userId,
    providerKind: 'stripe_checkout',
  })

  const metadata: Stripe.MetadataParam = {
    waoowaoo_kind: PLAN_PURCHASE_KIND,
    user_id: input.userId,
    plan_id: plan.id,
    plan_interval: input.interval,
    monthly_credits: String(plan.monthlyCredits),
    credit_unit_cny: String(CREDIT_UNIT_CNY),
    plan_quote_version: quote.version,
    plan_purchase_action: quote.action,
    list_price_cny: quote.listPriceCny.toFixed(2),
    payment_amount: quote.amountCny.toFixed(2),
    payment_currency: quote.currency,
    [PAID_BETA_ATTEMPT_METADATA_KEY]: attempt.attemptId,
    [PAID_BETA_SEAT_METADATA_KEY]: attempt.seatId,
  }

  try {
    const session = await createStripeClient().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: `${origin}/${input.locale}/profile?section=billing&plan=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${input.locale}/profile?section=billing&plan=cancel`,
      expires_at: Math.floor(attempt.expiresAt.getTime() / 1000),
      client_reference_id: input.userId,
      ...(input.email ? { customer_email: input.email } : {}),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: quote.currency,
          unit_amount: quote.amountMinor,
          product_data: {
            name: text.name,
            description: text.description,
          },
        },
      }],
      metadata,
      payment_intent_data: { metadata },
    }, { idempotencyKey: `paid-beta:${attempt.attemptId}` })

    if (!session.url) throw new Error('STRIPE_CHECKOUT_RESPONSE_MISSING_URL')
    await attachPaidBetaProviderObject({
      attemptId: attempt.attemptId,
      providerObjectId: session.id,
    })
    return {
      id: session.id,
      url: session.url,
      planId: plan.id,
      interval: input.interval,
      priceCny: quote.amountCny,
      monthlyCredits: plan.monthlyCredits,
    }
  } catch (error) {
    await failPaidBetaPaymentAttempt(attempt.attemptId)
    throw error
  }
}
