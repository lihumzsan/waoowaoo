import { BillingOperationError } from './errors'
import type { ApiType } from './cost'
import type { BillingMode } from './types'

export function assertPositiveChargeForBillingMode(
  mode: BillingMode,
  amount: number,
  info: {
    taskType: string
    apiType: ApiType
    model: string
  },
): void {
  if (amount > 0) return
  if (mode !== 'ENFORCE') return

  throw new BillingOperationError(
    'BILLING_INVALID_CHARGED_AMOUNT',
    `ENFORCE billing requires a positive charge for ${info.taskType}`,
    {
      taskType: info.taskType,
      apiType: info.apiType,
      model: info.model,
      amount,
    },
  )
}
