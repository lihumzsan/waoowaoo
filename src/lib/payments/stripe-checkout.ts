import { quoteRecharge, type RechargeQuote } from './recharge-config'

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

function readStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('STRIPE_SECRET_KEY_REQUIRED')
  }
  return key.trim()
}

function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error('PAYMENT_PUBLIC_ORIGIN_INVALID')
  }
  return trimmed
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStripeSessionResponse(value: unknown): { id: string; url: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('STRIPE_CHECKOUT_RESPONSE_INVALID')
  }
  const id = readString(Reflect.get(value, 'id'))
  const url = readString(Reflect.get(value, 'url'))
  if (!id || !url) {
    throw new Error('STRIPE_CHECKOUT_RESPONSE_MISSING_URL')
  }
  return { id, url }
}

function readStripeErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const error = Reflect.get(value, 'error')
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null
  return readString(Reflect.get(error, 'message'))
}

function appendMetadata(params: URLSearchParams, prefix: string, quote: RechargeQuote, userId: string): void {
  params.set(`${prefix}[waoowaoo_kind]`, 'credit_recharge')
  params.set(`${prefix}[user_id]`, userId)
  params.set(`${prefix}[credits]`, quote.credits.toFixed(2))
  params.set(`${prefix}[credit_value_currency]`, quote.creditValueCurrency)
  params.set(`${prefix}[settlement_amount]`, quote.settlementAmount.toFixed(2))
  params.set(`${prefix}[settlement_currency]`, quote.settlementCurrency.toLowerCase())
  params.set(`${prefix}[cny_to_hkd_rate]`, String(quote.cnyToHkdRate))
}

function getCheckoutProductText(locale: 'zh' | 'en', quote: RechargeQuote): { name: string; description: string } {
  if (locale === 'en') {
    return {
      name: 'WaooAI Credits',
      description: `${quote.credits.toFixed(2)} credits, billed in ${quote.settlementCurrency}`,
    }
  }
  return {
    name: 'WaooAI 额度',
    description: `${quote.credits.toFixed(2)} 额度，使用 ${quote.settlementCurrency} 结算`,
  }
}

export async function createStripeCheckoutSession(input: CreateStripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult> {
  const quote = quoteRecharge(input.credits)
  const origin = normalizeOrigin(input.origin)
  const params = new URLSearchParams()
  const successUrl = `${origin}/${input.locale}/profile?section=billing&payment=success&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${origin}/${input.locale}/profile?section=billing&payment=cancel`
  const productText = getCheckoutProductText(input.locale, quote)

  params.set('mode', 'payment')
  params.set('success_url', successUrl)
  params.set('cancel_url', cancelUrl)
  params.set('client_reference_id', input.userId)
  params.set('automatic_payment_methods[enabled]', 'true')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', quote.settlementCurrency.toLowerCase())
  params.set('line_items[0][price_data][unit_amount]', String(quote.settlementUnitAmount))
  params.set('line_items[0][price_data][product_data][name]', productText.name)
  params.set('line_items[0][price_data][product_data][description]', productText.description)
  if (input.email) {
    params.set('customer_email', input.email)
  }
  appendMetadata(params, 'metadata', quote, input.userId)
  appendMetadata(params, 'payment_intent_data[metadata]', quote, input.userId)

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${readStripeSecretKey()}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })

  const payload: unknown = await response.json()
  if (!response.ok) {
    throw new Error(readStripeErrorMessage(payload) || `STRIPE_CHECKOUT_CREATE_FAILED_${response.status}`)
  }

  const session = readStripeSessionResponse(payload)
  return {
    id: session.id,
    url: session.url,
    quote,
  }
}
