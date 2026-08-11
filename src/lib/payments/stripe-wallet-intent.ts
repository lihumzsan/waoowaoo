import type Stripe from 'stripe'
import {
  getSubscriptionPlan,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from '@/lib/billing/subscription-plans'
import {
  attachPaidBetaProviderObject,
  failPaidBetaPaymentAttempt,
  PAID_BETA_ATTEMPT_METADATA_KEY,
  PAID_BETA_SEAT_METADATA_KEY,
} from '@/lib/paid-beta/campaign'
import { admitPaidBetaPayment } from './paid-beta-admission'
import { quotePlanPurchase } from './plan-purchase-quote'
import { quoteRecharge, STRIPE_PAYMENT_CURRENCY, type RechargeQuote } from './recharge-config'
import { createStripeClient } from './stripe-client'
import {
  getStripeWalletMethodConfig,
  type StripeWalletMethodId,
} from './stripe-wallet-methods'

export interface CreateStripeWalletRechargeIntentInput {
  readonly method: StripeWalletMethodId
  readonly userId: string
  readonly credits: number
}

export interface CreateStripeWalletPlanIntentInput {
  readonly method: StripeWalletMethodId
  readonly userId: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
}

export interface StripeWalletPlanIntentResult {
  readonly paymentIntentId: string
  readonly clientSecret: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
  readonly amountCny: number
}

export interface StripeWalletRechargeIntentResult {
  readonly paymentIntentId: string
  readonly clientSecret: string
  readonly quote: RechargeQuote
}

function buildRechargeMetadata(
  method: ReturnType<typeof getStripeWalletMethodConfig>,
  quote: RechargeQuote,
  userId: string,
  attempt: { readonly attemptId: string; readonly seatId: string },
): Stripe.MetadataParam {
  return {
    waoowaoo_kind: method.rechargeMetadataKind,
    user_id: userId,
    credits: String(quote.credits),
    credit_value_currency: quote.creditValueCurrency,
    payment_amount: quote.paymentAmount.toFixed(2),
    payment_currency: quote.paymentCurrency.toLowerCase(),
    [PAID_BETA_ATTEMPT_METADATA_KEY]: attempt.attemptId,
    [PAID_BETA_SEAT_METADATA_KEY]: attempt.seatId,
  }
}

/**
 * Create a one-off wallet PaymentIntent. Stripe owns payment authorization;
 * the webhook remains the only balance writer after it succeeds.
 */
export async function createStripeWalletRechargeIntent(
  input: CreateStripeWalletRechargeIntentInput,
): Promise<StripeWalletRechargeIntentResult> {
  const method = getStripeWalletMethodConfig(input.method)
  const quote = quoteRecharge(input.credits)
  const attempt = await admitPaidBetaPayment({
    userId: input.userId,
    providerKind: method.paidBetaProviderKind,
  })

  try {
    const intent = await createStripeClient().paymentIntents.create({
      amount: quote.paymentUnitAmount,
      currency: STRIPE_PAYMENT_CURRENCY.toLowerCase(),
      payment_method_types: [method.id],
      metadata: buildRechargeMetadata(method, quote, input.userId, attempt),
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

/** Buy a plan term with a one-off Stripe wallet payment. */
export async function createStripeWalletPlanIntent(
  input: CreateStripeWalletPlanIntentInput,
): Promise<StripeWalletPlanIntentResult> {
  const method = getStripeWalletMethodConfig(input.method)
  const plan = getSubscriptionPlan(input.planId)
  const quote = await quotePlanPurchase(input)
  const attempt = await admitPaidBetaPayment({
    userId: input.userId,
    providerKind: method.paidBetaProviderKind,
  })

  try {
    const intent = await createStripeClient().paymentIntents.create({
      amount: quote.amountMinor,
      currency: quote.currency,
      payment_method_types: [method.id],
      metadata: {
        waoowaoo_kind: method.planMetadataKind,
        user_id: input.userId,
        plan_id: plan.id,
        plan_interval: input.interval,
        monthly_credits: String(plan.monthlyCredits),
        plan_quote_version: quote.version,
        plan_purchase_action: quote.action,
        list_price_cny: quote.listPriceCny.toFixed(2),
        payment_amount: quote.amountCny.toFixed(2),
        payment_currency: quote.currency,
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
      amountCny: quote.amountCny,
    }
  } catch (error) {
    await failPaidBetaPaymentAttempt(attempt.attemptId)
    throw error
  }
}
