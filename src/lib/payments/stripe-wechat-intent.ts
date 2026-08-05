import type Stripe from 'stripe'
import {
  getSubscriptionPlan,
  subscriptionPeriodPriceCny,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from '@/lib/billing/subscription-plans'
import { quoteRecharge, STRIPE_PAYMENT_CURRENCY, type RechargeQuote } from './recharge-config'
import { createStripeClient } from './stripe-client'
import { admitPaidBetaPayment } from './paid-beta-admission'
import {
  attachPaidBetaProviderObject,
  failPaidBetaPaymentAttempt,
  PAID_BETA_ATTEMPT_METADATA_KEY,
  PAID_BETA_SEAT_METADATA_KEY,
} from '@/lib/paid-beta/campaign'

/**
 * WeChat Pay top-up, paid without leaving the site.
 *
 * Stripe Checkout redirects the user away and, in subscription mode, does not
 * offer WeChat Pay at all. A raw PaymentIntent avoids both: the browser
 * confirms it with `client: 'web'`, Stripe returns a QR code, and the user
 * scans it on our page. Stripe still processes the money — this changes where
 * the QR is displayed, not who handles the payment.
 *
 * One-time only. WeChat Pay cannot back an automatically renewing subscription
 * on Stripe today, so subscriptions stay on cards.
 */

export const WECHAT_RECHARGE_KIND = 'credit_recharge_wechat'
export const WECHAT_PLAN_KIND = 'credit_plan_wechat'

export interface CreateWechatRechargeIntentInput {
  readonly userId: string
  readonly credits: number
}

export interface CreateWechatPlanIntentInput {
  readonly userId: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
}

export interface WechatPlanIntentResult {
  readonly paymentIntentId: string
  readonly clientSecret: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
  readonly amountCny: number
}

export interface WechatRechargeIntentResult {
  readonly paymentIntentId: string
  readonly clientSecret: string
  readonly quote: RechargeQuote
}

function buildIntentMetadata(
  quote: RechargeQuote,
  userId: string,
  attempt: { readonly attemptId: string; readonly seatId: string },
): Stripe.MetadataParam {
  return {
    // The webhook credits a balance from these values, so they carry the same
    // facts a Checkout session would: who, how many credits, and what was paid.
    waoowaoo_kind: WECHAT_RECHARGE_KIND,
    user_id: userId,
    credits: String(quote.credits),
    credit_value_currency: quote.creditValueCurrency,
    payment_amount: quote.paymentAmount.toFixed(2),
    payment_currency: quote.paymentCurrency.toLowerCase(),
    [PAID_BETA_ATTEMPT_METADATA_KEY]: attempt.attemptId,
    [PAID_BETA_SEAT_METADATA_KEY]: attempt.seatId,
  }
}

export async function createWechatRechargeIntent(
  input: CreateWechatRechargeIntentInput,
): Promise<WechatRechargeIntentResult> {
  const quote = quoteRecharge(input.credits)
  const attempt = await admitPaidBetaPayment({
    userId: input.userId,
    providerKind: 'stripe_wechat',
  })

  try {
    const intent = await createStripeClient().paymentIntents.create({
      amount: quote.paymentUnitAmount,
      currency: STRIPE_PAYMENT_CURRENCY.toLowerCase(),
      // Named explicitly rather than left to automatic selection: this endpoint
      // exists to produce a WeChat QR code, and silently falling back to another
      // method would leave the browser confirming a payment it cannot render.
      payment_method_types: ['wechat_pay'],
      metadata: buildIntentMetadata(quote, input.userId, attempt),
    }, { idempotencyKey: `paid-beta:${attempt.attemptId}` })

    if (!intent.client_secret) throw new Error('STRIPE_PAYMENT_INTENT_MISSING_CLIENT_SECRET')
    await attachPaidBetaProviderObject({
      attemptId: attempt.attemptId,
      providerObjectId: intent.id,
    })
    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      quote,
    }
  } catch (error) {
    await failPaidBetaPaymentAttempt(attempt.attemptId)
    throw error
  }
}

/**
 * Buy a plan term with WeChat, without leaving the page.
 *
 * The hosted Checkout works too, but it redirects away and asks for an email
 * and a name that a QR scan does not need. This keeps the whole purchase on
 * our page: the browser confirms the intent, Stripe returns a QR, and the
 * webhook starts the term once the scan clears.
 */
export async function createWechatPlanIntent(
  input: CreateWechatPlanIntentInput,
): Promise<WechatPlanIntentResult> {
  const plan = getSubscriptionPlan(input.planId)
  const listPriceCny = subscriptionPeriodPriceCny(plan, input.interval)
  // The promo is a first-purchase discount on the monthly term. It changes what
  // is charged, never what the term grants.
  const promoCny = input.interval === 'month' ? plan.firstMonthPromoCny : null
  const amountCny = promoCny ?? listPriceCny
  const minorAmount = Math.round(amountCny * 100)
  if (!Number.isSafeInteger(minorAmount) || minorAmount <= 0) {
    throw new Error('PAYMENT_AMOUNT_INVALID')
  }

  const attempt = await admitPaidBetaPayment({
    userId: input.userId,
    providerKind: 'stripe_wechat',
  })

  try {
    const intent = await createStripeClient().paymentIntents.create({
      amount: minorAmount,
      currency: STRIPE_PAYMENT_CURRENCY.toLowerCase(),
      payment_method_types: ['wechat_pay'],
      metadata: {
        waoowaoo_kind: WECHAT_PLAN_KIND,
        user_id: input.userId,
        plan_id: plan.id,
        plan_interval: input.interval,
        monthly_credits: String(plan.monthlyCredits),
        payment_amount: amountCny.toFixed(2),
        payment_currency: STRIPE_PAYMENT_CURRENCY.toLowerCase(),
        [PAID_BETA_ATTEMPT_METADATA_KEY]: attempt.attemptId,
        [PAID_BETA_SEAT_METADATA_KEY]: attempt.seatId,
      },
    }, { idempotencyKey: `paid-beta:${attempt.attemptId}` })

    if (!intent.client_secret) throw new Error('STRIPE_PAYMENT_INTENT_MISSING_CLIENT_SECRET')
    await attachPaidBetaProviderObject({
      attemptId: attempt.attemptId,
      providerObjectId: intent.id,
    })
    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      planId: plan.id,
      interval: input.interval,
      amountCny,
    }
  } catch (error) {
    await failPaidBetaPaymentAttempt(attempt.attemptId)
    throw error
  }
}
