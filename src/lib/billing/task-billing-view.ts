import { getBillingMode } from '@/lib/billing/mode'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import type { BillingMode, TaskBillingInfo, TaskType } from '@/lib/task/types'

export interface BillingReceiptView {
  showCredits: boolean
  billingMode: BillingMode | null
  billable: boolean
  taskType?: TaskType
  apiType?: 'image' | 'video' | 'music' | 'voice' | 'text'
  model?: string
  quantity?: number
  unit?: 'token' | 'image' | 'video' | 'second' | 'call' | 'character'
  maxFrozenCost?: number
  chargedCost?: number
  status?: 'skipped' | 'quoted' | 'frozen' | 'settled' | 'rolled_back' | 'failed'
  pricingVersion?: string
}

export function shouldExposeBillingCredits(): boolean {
  const deployment = getDeploymentConfig()
  return getDeploymentFeatures(deployment).showBilling
}

export async function buildBillingReceiptView(
  billingInfo: TaskBillingInfo | null,
): Promise<BillingReceiptView | null> {
  const showCredits = shouldExposeBillingCredits()
  const billingMode = await getBillingMode().catch(() => null)
  if (!billingInfo || billingInfo.billable !== true) {
    return null
  }
  return {
    showCredits,
    billingMode,
    billable: true,
    taskType: billingInfo.taskType,
    apiType: billingInfo.apiType,
    model: billingInfo.model,
    quantity: billingInfo.quantity,
    unit: billingInfo.unit,
    ...(showCredits ? {
      maxFrozenCost: billingInfo.maxFrozenCost,
      ...(typeof billingInfo.chargedCost === 'number' ? { chargedCost: billingInfo.chargedCost } : {}),
    } : {}),
    status: billingInfo.status,
    pricingVersion: billingInfo.pricingVersion,
  }
}
