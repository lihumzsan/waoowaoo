import type Stripe from 'stripe'
import { quoteRecharge, type RechargeQuote } from './recharge-config'
import { createStripeClient } from './stripe-client'
import { admitPaidBetaPayment } from './paid-beta-admission'
import {
  attachPaidBetaProviderObject,
  failPaidBetaPaymentAttempt,
  PAID_BETA_ATTEMPT_METADATA_KEY,
  PAID_BETA_SEAT_METADATA_KEY,
} from '@/lib/paid-beta/campaign'

export interface CreateStripeCheckoutSessionInput {
  userId: string
  email?: string | null
  locale: 'zh' | 'en'
  origin: string
  credits: number
}

export interface StripeCheckoutSessionResult {
  id: string
  url: string
  quote: RechargeQuote
}

function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error('PAYMENT_PUBLIC_ORIGIN_INVALID')
  }
  return trimmed
}

function buildCheckoutMetadata(
  quote: RechargeQuote,
  userId: string,
  attempt: { readonly attemptId: string; readonly seatId: string },
): Stripe.MetadataParam {
  return {
    waoowaoo_kind: 'credit_recharge',
    user_id: userId,
    credits: String(quote.credits),
    credit_value_currency: quote.creditValueCurrency,
    payment_amount: quote.paymentAmount.toFixed(2),
    payment_currency: quote.paymentCurrency.toLowerCase(),
    [PAID_BETA_ATTEMPT_METADATA_KEY]: attempt.attemptId,
    [PAID_BETA_SEAT_METADATA_KEY]: attempt.seatId,
  }
}

function getCheckoutProductText(locale: 'zh' | 'en', quote: RechargeQuote): { name: string; description: string } {
  if (locale === 'en') {
    return {
      name: 'WaooAI Credits',
      description: `${quote.credits} credits, billed in ${quote.paymentCurrency}`,
    }
  }
  return {
    name: 'WaooAI 额度',
    description: `${quote.credits} 额度，使用人民币支付`,
  }
}

export async function createStripeCheckoutSession(input: CreateStripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult> {
  const quote = quoteRecharge(input.credits)
  const origin = normalizeOrigin(input.origin)
  const successUrl = `${origin}/${input.locale}/profile?section=billing&payment=success&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${origin}/${input.locale}/profile?section=billing&payment=cancel`
  const productText = getCheckoutProductText(input.locale, quote)
  const attempt = await admitPaidBetaPayment({
    userId: input.userId,
    providerKind: 'stripe_checkout',
  })
  const metadata = buildCheckoutMetadata(quote, input.userId, attempt)

  try {
    const session = await createStripeClient().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      expires_at: Math.floor(attempt.expiresAt.getTime() / 1000),
      client_reference_id: input.userId,
      ...(input.email ? { customer_email: input.email } : {}),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: quote.paymentCurrency.toLowerCase(),
          unit_amount: quote.paymentUnitAmount,
          product_data: {
            name: productText.name,
            description: productText.description,
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
      quote,
    }
  } catch (error) {
    await failPaidBetaPaymentAttempt(attempt.attemptId)
    throw error
  }
}
