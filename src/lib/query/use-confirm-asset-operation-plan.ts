'use client'

import { useTranslations } from 'next-intl'
import {
  buildOperationPlanConfirmationText,
  fetchAssetOperationPlanView,
  readPlanConfirmedMaxCost,
} from './operation-plan-client'

export function useConfirmAssetOperationPlan() {
  const t = useTranslations('assistantAgent')

  return async (
    assetId: string,
    action: 'generate' | 'modify-render',
    input: Record<string, unknown>,
  ) => {
    const plan = await fetchAssetOperationPlanView({
      assetId,
      action,
      input,
    })
    const message = buildOperationPlanConfirmationText({
      plan,
      withCredits: (values) => t('cards.billingQuoteWithCredits', values),
      withoutCredits: (values) => t('cards.billingQuoteWithoutCredits', values),
    })
    if (message && !window.confirm(message)) {
      throw new Error(t('cards.billingConfirmationCancelled'))
    }
    return readPlanConfirmedMaxCost(plan)
  }
}
