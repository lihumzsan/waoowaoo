/**
 * Credits are the platform's only billing unit.
 *
 * A credit is an integer. Every persisted balance, freeze, transaction and
 * settlement amount is a whole number of credits — there is no fractional
 * credit anywhere in the ledger. Pricing rates may be fractional (per token,
 * per character), but every amount that reaches a user or the ledger is
 * rounded up to a whole credit by `toChargeableCredits`.
 */

/** Retail value of one credit, in CNY. Purchases convert at this rate. */
export const CREDIT_UNIT_CNY = 0.1

/** Credits granted per 1 CNY paid, at face value (no plan bonus). */
export const CREDITS_PER_CNY = 10

export class CreditAmountError extends Error {
  constructor(message: string, readonly value: unknown) {
    super(message)
    this.name = 'CreditAmountError'
  }
}

/**
 * Assert a value is a valid persisted credit amount: a non-negative safe
 * integer. Ledger writers call this before touching a balance so a fractional
 * or NaN amount fails at the boundary instead of corrupting a balance.
 */
export function assertCreditAmount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CreditAmountError(`${field} must be a non-negative safe integer number of credits`, value)
  }
  return value
}

/** Same as `assertCreditAmount` but allows negative values (signed adjustments). */
export function assertSignedCreditAmount(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new CreditAmountError(`${field} must be a safe integer number of credits`, value)
  }
  return value
}

/**
 * Convert a computed price into the amount actually charged.
 *
 * Rounding is always up: a partial credit is a credit. This is the single
 * place fractional pricing rates become ledger amounts, so quotes and
 * settlements can never disagree about the rounding rule.
 */
export function toChargeableCredits(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CreditAmountError('chargeable credits must be a finite non-negative number', value)
  }
  const rounded = Math.ceil(value)
  if (!Number.isSafeInteger(rounded)) {
    throw new CreditAmountError('chargeable credits exceed the safe integer range', value)
  }
  return rounded
}

/**
 * Render a credit amount for display.
 *
 * Grouping is done by hand rather than through `Intl`, because this runs on
 * both the server and the client and a locale-dependent separator would cause
 * a hydration mismatch. A fractional value is a bug upstream, so it is shown
 * as-is instead of being silently rounded into something that looks correct.
 */
export function formatCredits(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (!Number.isInteger(value)) return String(value)
  const negative = value < 0
  const digits = String(Math.abs(value))
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return negative ? `-${grouped}` : grouped
}

/** CNY payable for a credit amount, used only when building a payment intent. */
export function creditsToPaymentCny(credits: number): number {
  assertCreditAmount(credits, 'credits')
  return credits * CREDIT_UNIT_CNY
}

/** Smallest-currency-unit (fen) amount for a credit amount. */
export function creditsToPaymentMinorUnits(credits: number): number {
  assertCreditAmount(credits, 'credits')
  // credits * 0.1 CNY * 100 fen — expressed as integer arithmetic so no
  // floating point rounding can reach the payment provider.
  return credits * 10
}

/** Whole credits bought by an exact CNY amount entered by the user. */
export function paymentCnyToCredits(amountCny: number): number {
  if (!Number.isFinite(amountCny) || amountCny <= 0) {
    throw new CreditAmountError('payment amount must be a finite positive CNY amount', amountCny)
  }
  const amountFen = amountCny * 100
  if (!Number.isSafeInteger(amountFen) || amountFen % 10 !== 0) {
    throw new CreditAmountError('payment amount must resolve to a whole number of credits', amountCny)
  }
  return amountFen / 10
}
