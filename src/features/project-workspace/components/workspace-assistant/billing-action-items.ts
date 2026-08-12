import type { OperationPlanView } from '@/lib/operations/plan-contract'

type BillingQuoteItemView = OperationPlanView['quote']['items'][number]
type BillingActionItemKey =
  | 'image'
  | 'video'
  | 'music'
  | 'voiceCharacters'
  | 'musicSeconds'
  | 'videoSeconds'

export interface BillingActionItemSummary {
  readonly key: BillingActionItemKey
  readonly quantity: number
}

function toPositiveBillingQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value
}

function resolveBillingActionItemKey(item: BillingQuoteItemView): BillingActionItemKey | null {
  if (item.unit === 'image') return 'image'
  if (item.unit === 'video') return 'video'
  if (item.unit === 'music') return 'music'
  if (item.unit === 'second' && item.apiType === 'music') return 'musicSeconds'
  if (item.unit === 'second' && item.apiType === 'video') return 'videoSeconds'
  if (item.unit === 'call' && item.apiType === 'music') return 'music'
  if (item.unit === 'character' && item.apiType === 'voice') return 'voiceCharacters'
  return null
}

export function summarizeBillingActionItems(
  items: readonly BillingQuoteItemView[],
): BillingActionItemSummary[] {
  const totals = new Map<BillingActionItemKey, number>()
  for (const item of items) {
    const key = resolveBillingActionItemKey(item)
    if (!key) continue
    const quantity = toPositiveBillingQuantity(item.quantity)
    if (quantity <= 0) continue
    totals.set(key, (totals.get(key) ?? 0) + quantity)
  }
  return Array.from(totals.entries()).map(([key, quantity]) => ({ key, quantity }))
}
