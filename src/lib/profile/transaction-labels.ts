export type ProfileTransactionKindTranslationKey =
  | 'transactionKinds.consume'
  | 'transactionKinds.recharge'
  | 'transactionKinds.freeze'
  | 'transactionKinds.refund'
  | 'transactionKinds.planPurchase'
  | 'transactionKinds.planGrant'
  | 'transactionKinds.planExpire'

/**
 * Every ledger row type gets its own label.
 *
 * The default used to be "recharge", which meant a plan purchase and a monthly
 * expiry both read as money added — the opposite of what an expiry is. Unknown
 * types still fall back, but the types we actually write are all named.
 */
export function getProfileTransactionKindTranslationKey(type: string): ProfileTransactionKindTranslationKey {
  if (type === 'consume' || type === 'shadow_consume') return 'transactionKinds.consume'
  if (type === 'freeze') return 'transactionKinds.freeze'
  if (type === 'refund') return 'transactionKinds.refund'
  if (type === 'plan_purchase') return 'transactionKinds.planPurchase'
  if (type === 'subscription_grant') return 'transactionKinds.planGrant'
  if (type === 'subscription_expire') return 'transactionKinds.planExpire'
  return 'transactionKinds.recharge'
}
