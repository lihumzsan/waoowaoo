import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { roundMoney } from '@/lib/billing/money'

export const CREDIT_VALUE_CURRENCY = 'CNY' as const
export const STRIPE_SETTLEMENT_CURRENCY = 'HKD' as const

export interface RechargeConfig {
  enabled: boolean
  creditValueCurrency: typeof CREDIT_VALUE_CURRENCY
  settlementCurrency: typeof STRIPE_SETTLEMENT_CURRENCY
  minCredits: number
  maxCredits: number
  cnyToHkdRate: number
}

export interface RechargeQuote {
  credits: number
  settlementAmount: number
  settlementUnitAmount: number
  creditValueCurrency: typeof CREDIT_VALUE_CURRENCY
  settlementCurrency: typeof STRIPE_SETTLEMENT_CURRENCY
  cnyToHkdRate: number
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
    settlementCurrency: STRIPE_SETTLEMENT_CURRENCY,
    minCredits: 0,
    maxCredits: 0,
    cnyToHkdRate: 0,
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
    settlementCurrency: STRIPE_SETTLEMENT_CURRENCY,
    minCredits,
    maxCredits,
    cnyToHkdRate: readRequiredPositiveNumber('PAYMENT_CNY_TO_HKD_RATE'),
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
  const settlementAmount = roundMoney(credits * config.cnyToHkdRate, 2)
  const settlementUnitAmount = Math.round(settlementAmount * 100)
  if (!Number.isInteger(settlementUnitAmount) || settlementUnitAmount <= 0) {
    throw new Error('PAYMENT_SETTLEMENT_AMOUNT_INVALID')
  }
  return {
    credits,
    settlementAmount,
    settlementUnitAmount,
    creditValueCurrency: config.creditValueCurrency,
    settlementCurrency: config.settlementCurrency,
    cnyToHkdRate: config.cnyToHkdRate,
  }
}
