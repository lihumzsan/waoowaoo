import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { creditsToPaymentCny, creditsToPaymentMinorUnits } from '@/lib/billing/credits'

export const CREDIT_VALUE_CURRENCY = 'CNY' as const
export const STRIPE_PAYMENT_CURRENCY = 'CNY' as const

export interface RechargeConfig {
  enabled: boolean
  /**
   * Browser-safe Stripe key, present only when WeChat's in-page QR flow can
   * run. Absent means the client must not offer WeChat — it would have no way
   * to confirm the PaymentIntent.
   */
  publishableKey: string | null
  wechatEnabled: boolean
  creditValueCurrency: typeof CREDIT_VALUE_CURRENCY
  paymentCurrency: typeof STRIPE_PAYMENT_CURRENCY
  minCredits: number
  maxCredits: number
}

export interface RechargeQuote {
  credits: number
  paymentAmount: number
  paymentUnitAmount: number
  creditValueCurrency: typeof CREDIT_VALUE_CURRENCY
  paymentCurrency: typeof STRIPE_PAYMENT_CURRENCY
}

function readRequiredPositiveInteger(name: string): number {
  const raw = process.env[name]
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`${name}_REQUIRED`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name}_INVALID`)
  }
  return value
}

function readOptionalKey(name: string): string | null {
  const raw = process.env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

function disabledRechargeConfig(): RechargeConfig {
  return {
    enabled: false,
    publishableKey: null,
    wechatEnabled: false,
    creditValueCurrency: CREDIT_VALUE_CURRENCY,
    paymentCurrency: STRIPE_PAYMENT_CURRENCY,
    minCredits: 0,
    maxCredits: 0,
  }
}

export function getRechargeConfig(): RechargeConfig {
  if (!getDeploymentFeatures(getDeploymentConfig()).showRecharge) return disabledRechargeConfig()

  const minCredits = readRequiredPositiveInteger('PAYMENT_MIN_CREDITS')
  const maxCredits = readRequiredPositiveInteger('PAYMENT_MAX_CREDITS')
  if (maxCredits < minCredits) {
    throw new Error('PAYMENT_MAX_CREDITS_LESS_THAN_MIN')
  }

  // WeChat's in-page QR needs Stripe.js in the browser, which needs a
  // publishable key. Without one the option is simply not offered rather than
  // failing when the user clicks it.
  const publishableKey = readOptionalKey('STRIPE_PUBLISHABLE_KEY')
  return {
    enabled: true,
    publishableKey,
    wechatEnabled: publishableKey !== null,
    creditValueCurrency: CREDIT_VALUE_CURRENCY,
    paymentCurrency: STRIPE_PAYMENT_CURRENCY,
    minCredits,
    maxCredits,
  }
}

export function normalizeRechargeCredits(input: number, config: RechargeConfig): number {
  if (!config.enabled) {
    throw new Error('PAYMENT_RECHARGE_DISABLED')
  }
  // Credits are whole units. A fractional request is rejected rather than
  // rounded, so the amount the user sees is the amount that is charged.
  if (!Number.isSafeInteger(input) || input <= 0) {
    throw new Error('PAYMENT_CREDITS_INVALID')
  }
  if (input < config.minCredits) {
    throw new Error('PAYMENT_CREDITS_BELOW_MIN')
  }
  if (input > config.maxCredits) {
    throw new Error('PAYMENT_CREDITS_ABOVE_MAX')
  }
  return input
}

export function quoteRecharge(inputCredits: number, config: RechargeConfig = getRechargeConfig()): RechargeQuote {
  const credits = normalizeRechargeCredits(inputCredits, config)
  // Integer arithmetic all the way to the payment provider: one credit is
  // 10 fen, so no floating point rounding can reach Stripe.
  const paymentUnitAmount = creditsToPaymentMinorUnits(credits)
  const paymentAmount = creditsToPaymentCny(credits)
  if (!Number.isSafeInteger(paymentUnitAmount) || paymentUnitAmount <= 0) {
    throw new Error('PAYMENT_AMOUNT_INVALID')
  }
  return {
    credits,
    paymentAmount,
    paymentUnitAmount,
    creditValueCurrency: config.creditValueCurrency,
    paymentCurrency: config.paymentCurrency,
  }
}
