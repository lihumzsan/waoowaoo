export type ProfileTransactionKindTranslationKey =
  | 'transactionKinds.consume'
  | 'transactionKinds.recharge'
  | 'transactionKinds.freeze'
  | 'transactionKinds.refund'

export function getProfileTransactionKindTranslationKey(type: string): ProfileTransactionKindTranslationKey {
  if (type === 'consume' || type === 'shadow_consume') return 'transactionKinds.consume'
  if (type === 'freeze') return 'transactionKinds.freeze'
  if (type === 'refund') return 'transactionKinds.refund'
  return 'transactionKinds.recharge'
}
