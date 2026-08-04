import type Stripe from 'stripe'
import { quoteRecharge, STRIPE_PAYMENT_CURRENCY, type RechargeQuote } from './recharge-config'
import { createStripeClient } from './stripe-client'

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

export interface CreateWechatRechargeIntentInput {
  readonly userId: string
  readonly credits: number
}

export interface WechatRechargeIntentResult {
  readonly paymentIntentId: string
  readonly clientSecret: string
  readonly quote: RechargeQuote
}

function buildIntentMetadata(quote: RechargeQuote, userId: string): Stripe.MetadataParam {
  return {
    // The webhook credits a balance from these values, so they carry the same
    // facts a Checkout session would: who, how many credits, and what was paid.
    waoowaoo_kind: WECHAT_RECHARGE_KIND,
    user_id: userId,
    credits: String(quote.credits),
    credit_value_currency: quote.creditValueCurrency,
    payment_amount: quote.paymentAmount.toFixed(2),
    payment_currency: quote.paymentCurrency.toLowerCase(),
  }
}

export async function createWechatRechargeIntent(
  input: CreateWechatRechargeIntentInput,
): Promise<WechatRechargeIntentResult> {
  const quote = quoteRecharge(input.credits)

  const intent = await createStripeClient().paymentIntents.create({
    amount: quote.paymentUnitAmount,
    currency: STRIPE_PAYMENT_CURRENCY.toLowerCase(),
    // Named explicitly rather than left to automatic selection: this endpoint
    // exists to produce a WeChat QR code, and silently falling back to another
    // method would leave the browser confirming a payment it cannot render.
    payment_method_types: ['wechat_pay'],
    metadata: buildIntentMetadata(quote, input.userId),
  })

  if (!intent.client_secret) throw new Error('STRIPE_PAYMENT_INTENT_MISSING_CLIENT_SECRET')
  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    quote,
  }
}
