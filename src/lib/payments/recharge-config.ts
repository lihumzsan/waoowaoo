import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { roundMoney } from '@/lib/billing/money'

export const CREDIT_VALUE_CURRENCY = 'CNY' as const
export const STRIPE_PAYMENT_CURRENCY = 'CNY' as const

export interface RechargeConfig {
  enabled: boolean
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

function readRequiredPositiveNumber(name: string): number {
  const raw = process.env[name]
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`${name}_REQUIRED`)
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name}_INVALID`)
  }
  return value
}

function disabledRechargeConfig(): RechargeConfig {
  return {
    enabled: false,
    creditValueCurrency: CREDIT_VALUE_CURRENCY,
    paymentCurrency: STRIPE_PAYMENT_CURRENCY,
    minCredits: 0,
    maxCredits: 0,
  }
}

export function getRechargeConfig(): RechargeConfig {
  if (!getDeploymentFeatures(getDeploymentConfig()).showRecharge) return disabledRechargeConfig()

  const minCredits = readRequiredPositiveNumber('PAYMENT_MIN_CREDITS')
  const maxCredits = readRequiredPositiveNumber('PAYMENT_MAX_CREDITS')
  if (maxCredits < minCredits) {
    throw new Error('PAYMENT_MAX_CREDITS_LESS_THAN_MIN')
  }

  return {
    enabled: true,
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
  if (!Number.isFinite(input) || input <= 0) {
    throw new Error('PAYMENT_CREDITS_INVALID')
  }
  const credits = roundMoney(input, 2)
  if (credits < config.minCredits) {
    throw new Error('PAYMENT_CREDITS_BELOW_MIN')
  }
  if (credits > config.maxCredits) {
    throw new Error('PAYMENT_CREDITS_ABOVE_MAX')
  }
  return credits
}

export function quoteRecharge(inputCredits: number, config: RechargeConfig = getRechargeConfig()): RechargeQuote {
  const credits = normalizeRechargeCredits(inputCredits, config)
  const paymentAmount = roundMoney(credits, 2)
  const paymentUnitAmount = Math.round(paymentAmount * 100)
  if (!Number.isInteger(paymentUnitAmount) || paymentUnitAmount <= 0) {
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
