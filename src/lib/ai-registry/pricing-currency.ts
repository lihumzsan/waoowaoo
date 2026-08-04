export const BILLING_CREDIT_CURRENCY = 'CNY'
export const USD_TO_CNY = 7.2

export function usdToCredits(amountUsd: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    throw new Error('PRICING_CURRENCY_INVALID_USD_AMOUNT')
  }
  return Number((amountUsd * USD_TO_CNY).toFixed(6))
}
