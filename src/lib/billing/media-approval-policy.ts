import type { TaskBillingInfo } from '@/lib/task/types'

export const BILLABLE_MEDIA_API_TYPES = [
  'image',
  'video',
  'music',
  'sound_effect',
] as const

export type BillableMediaApiType = (typeof BILLABLE_MEDIA_API_TYPES)[number]

export function isBillableMediaApiType(value: unknown): value is BillableMediaApiType {
  return typeof value === 'string'
    && BILLABLE_MEDIA_API_TYPES.some((apiType) => apiType === value)
}

export function requiresBillableMediaApproval(
  billingInfo: TaskBillingInfo | null | undefined,
): billingInfo is Extract<TaskBillingInfo, { billable: true }> & { apiType: BillableMediaApiType } {
  return billingInfo?.billable === true && isBillableMediaApiType(billingInfo.apiType)
}
