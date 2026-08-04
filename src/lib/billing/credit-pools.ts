import { assertCreditAmount } from './credits'

/**
 * How a credit amount is split between the two pools.
 *
 * A balance is two pools, not one number: `subscription` credits arrive with
 * each billing period and expire at the end of it, and `recharge` credits were
 * bought outright and never expire. Every decision about which pool an amount
 * comes from or returns to is made here, so the ledger has one rule rather
 * than one per call site.
 *
 * The rule is always the same: spend the pool that expires first.
 */

export interface CreditPoolSplit {
  readonly subscription: number
  readonly recharge: number
}

export interface CreditPoolState {
  /** Raw column value; may be stale if the period has already ended. */
  readonly subscriptionCredits: number
  readonly subscriptionExpiresAt: Date | null
  readonly rechargeCredits: number
}

export const EMPTY_SPLIT: CreditPoolSplit = { subscription: 0, recharge: 0 }

export function splitTotal(split: CreditPoolSplit): number {
  return split.subscription + split.recharge
}

/**
 * Subscription credits usable right now.
 *
 * Expiry is decided when the balance is read, not by a job that has to run on
 * time: an expired period contributes zero even if the column still holds a
 * number and nothing has swept it yet. The sweep only writes the audit trail.
 */
export function usableSubscriptionCredits(state: CreditPoolState, now: Date): number {
  if (!state.subscriptionExpiresAt) return 0
  if (state.subscriptionExpiresAt.getTime() <= now.getTime()) return 0
  return Math.max(0, state.subscriptionCredits)
}

/** Total credits the user can spend right now. */
export function usableCredits(state: CreditPoolState, now: Date): number {
  return usableSubscriptionCredits(state, now) + Math.max(0, state.rechargeCredits)
}

/**
 * Decide which pools fund an amount, subscription first.
 *
 * Returns null when the pools cannot cover it — the caller reports insufficient
 * balance rather than partially funding a charge.
 */
export function planPoolDebit(
  state: CreditPoolState,
  amount: number,
  now: Date,
): CreditPoolSplit | null {
  assertCreditAmount(amount, 'amount')
  const subscriptionAvailable = usableSubscriptionCredits(state, now)
  const rechargeAvailable = Math.max(0, state.rechargeCredits)
  if (subscriptionAvailable + rechargeAvailable < amount) return null

  const subscription = Math.min(amount, subscriptionAvailable)
  return { subscription, recharge: amount - subscription }
}

/**
 * Split a settled charge across the pools a freeze drew from.
 *
 * The charge is applied to the subscription portion first for the same reason
 * the freeze took it first: those credits expire, so spending them is strictly
 * better for the user than letting them lapse while permanent credits are
 * consumed instead.
 */
export function splitSettlement(
  frozen: CreditPoolSplit,
  chargedAmount: number,
): { charged: CreditPoolSplit; refunded: CreditPoolSplit } {
  assertCreditAmount(chargedAmount, 'chargedAmount')
  const frozenTotal = splitTotal(frozen)
  if (chargedAmount > frozenTotal) {
    throw new Error('CREDIT_POOL_CHARGE_EXCEEDS_FREEZE')
  }
  const chargedSubscription = Math.min(chargedAmount, frozen.subscription)
  const chargedRecharge = chargedAmount - chargedSubscription
  return {
    charged: { subscription: chargedSubscription, recharge: chargedRecharge },
    refunded: {
      subscription: frozen.subscription - chargedSubscription,
      recharge: frozen.recharge - chargedRecharge,
    },
  }
}

/**
 * Decide what a refund to the subscription pool is actually worth.
 *
 * Credits released after the period they belong to has ended do not come back
 * to life — they would be spendable past their expiry. The dropped amount is
 * returned so the caller can record it instead of losing it silently.
 */
export function applyRefundExpiry(
  refunded: CreditPoolSplit,
  state: CreditPoolState,
  now: Date,
): { restored: CreditPoolSplit; expired: number } {
  const subscriptionStillValid = state.subscriptionExpiresAt !== null
    && state.subscriptionExpiresAt.getTime() > now.getTime()
  if (subscriptionStillValid || refunded.subscription === 0) {
    return { restored: refunded, expired: 0 }
  }
  return {
    restored: { subscription: 0, recharge: refunded.recharge },
    expired: refunded.subscription,
  }
}
