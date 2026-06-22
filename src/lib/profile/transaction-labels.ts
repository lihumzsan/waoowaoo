export type ProfileTransactionKindTranslationKey =
  | 'transactionKinds.consume'
  | 'transactionKinds.recharge'

export function getProfileTransactionKindTranslationKey(type: string): ProfileTransactionKindTranslationKey {
  return type === 'consume' ? 'transactionKinds.consume' : 'transactionKinds.recharge'
}
