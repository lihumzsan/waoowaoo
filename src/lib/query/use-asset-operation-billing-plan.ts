'use client'

import {
  fetchAssetOperationPlanView,
  readPlanConfirmedMaxCost,
} from './operation-plan-client'

export function useAssetOperationBillingPlan() {
  return async (
    assetId: string,
    action: 'generate',
    input: Record<string, unknown>,
  ) => {
    const plan = await fetchAssetOperationPlanView({
      assetId,
      action,
      input,
    })
    return readPlanConfirmedMaxCost(plan)
  }
}
