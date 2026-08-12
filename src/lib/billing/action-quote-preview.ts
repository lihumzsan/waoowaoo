import type { BillingQuoteView, OperationPlanView } from '@/lib/operations/plan-contract'

export interface BillingActionQuotePreview {
  readonly fullLabel: string
  readonly mediaTaskCount: number
  readonly costLabel?: string
  readonly totalMaxFrozenCost?: number
}

export function formatBillingActionCost(value: number): string {
  if (!Number.isFinite(value)) return ''
  return String(value)
}

export function buildBillingActionQuotePreview(params: {
  readonly plan: OperationPlanView
  readonly withCredits: (values: { readonly count: number; readonly cost: number }) => string
  readonly withoutCredits: (values: { readonly count: number }) => string
  readonly formatCost?: (cost: number) => string
}): BillingActionQuotePreview | null {
  return buildBillingActionQuotePreviewFromQuote({
    quote: params.plan.quote,
    withCredits: params.withCredits,
    withoutCredits: params.withoutCredits,
    ...(params.formatCost ? { formatCost: params.formatCost } : {}),
  })
}

export function buildBillingActionQuotePreviewFromQuote(params: {
  readonly quote: BillingQuoteView
  readonly withCredits: (values: { readonly count: number; readonly cost: number }) => string
  readonly withoutCredits: (values: { readonly count: number }) => string
  readonly formatCost?: (cost: number) => string
}): BillingActionQuotePreview | null {
  const quote = params.quote
  if (!quote.billable || quote.mediaTaskCount <= 0) return null

  if (quote.showCredits && typeof quote.totalMaxFrozenCost === 'number') {
    const fullLabel = params.withCredits({
      count: quote.mediaTaskCount,
      cost: quote.totalMaxFrozenCost,
    })
    const costLabel = (params.formatCost ?? formatBillingActionCost)(quote.totalMaxFrozenCost)
    return {
      fullLabel,
      mediaTaskCount: quote.mediaTaskCount,
      totalMaxFrozenCost: quote.totalMaxFrozenCost,
      ...(costLabel ? { costLabel } : {}),
    }
  }

  return {
    fullLabel: params.withoutCredits({
      count: quote.mediaTaskCount,
    }),
    mediaTaskCount: quote.mediaTaskCount,
  }
}
