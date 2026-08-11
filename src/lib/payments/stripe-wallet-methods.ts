import type { PaidBetaProviderKind } from '@/lib/paid-beta/campaign'

export const STRIPE_WALLET_METHOD_IDS = ['wechat_pay', 'alipay'] as const

export type StripeWalletMethodId = typeof STRIPE_WALLET_METHOD_IDS[number]
export type StripeWalletPaymentPurpose = 'recharge' | 'plan'

export interface StripeWalletMethodConfig {
  readonly id: StripeWalletMethodId
  readonly paidBetaProviderKind: PaidBetaProviderKind
  readonly rechargeMetadataKind: string
  readonly planMetadataKind: string
  readonly rechargeLedgerReason: string
}

const STRIPE_WALLET_METHOD_CONFIGS = {
  wechat_pay: {
    id: 'wechat_pay',
    paidBetaProviderKind: 'stripe_wechat',
    // These identities are already persisted on live Stripe objects. Keeping
    // them stable lets delayed and replayed events use the same resolver.
    rechargeMetadataKind: 'credit_recharge_wechat',
    planMetadataKind: 'credit_plan_wechat',
    rechargeLedgerReason: 'stripe wechat pay recharge',
  },
  alipay: {
    id: 'alipay',
    paidBetaProviderKind: 'stripe_alipay',
    rechargeMetadataKind: 'credit_recharge_alipay',
    planMetadataKind: 'credit_plan_alipay',
    rechargeLedgerReason: 'stripe alipay recharge',
  },
} as const satisfies Record<StripeWalletMethodId, StripeWalletMethodConfig>

export function getStripeWalletMethodConfig(
  method: StripeWalletMethodId,
): StripeWalletMethodConfig {
  return STRIPE_WALLET_METHOD_CONFIGS[method]
}

export function resolveStripeWalletMetadataKind(
  metadataKind: string | undefined,
): { readonly method: StripeWalletMethodConfig; readonly purpose: StripeWalletPaymentPurpose } | null {
  if (!metadataKind) return null
  for (const methodId of STRIPE_WALLET_METHOD_IDS) {
    const method = getStripeWalletMethodConfig(methodId)
    if (metadataKind === method.rechargeMetadataKind) return { method, purpose: 'recharge' }
    if (metadataKind === method.planMetadataKind) return { method, purpose: 'plan' }
  }
  return null
}
