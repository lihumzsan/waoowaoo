import { describe, expect, it } from 'vitest'
import {
  buildBillingActionQuotePreviewFromQuote,
  formatBillingActionCost,
} from '@/lib/billing/action-quote-preview'
import type { BillingQuoteView } from '@/lib/operations/planning'

const billableQuote: BillingQuoteView = {
  showCredits: true,
  billingMode: 'ENFORCE',
  billable: true,
  taskCount: 3,
  mediaTaskCount: 3,
  totalMaxFrozenCost: 3.4128,
  currency: 'credits',
  items: [],
}

describe('billing action quote preview', () => {
  it('builds a structured one-line preview without parsing localized copy', () => {
    const preview = buildBillingActionQuotePreviewFromQuote({
      quote: billableQuote,
      withCredits: ({ count, cost }) => `${count} tasks · ${cost} credits`,
      withoutCredits: ({ count }) => `${count} tasks`,
    })

    expect(preview).toEqual({
      fullLabel: '3 tasks · 3.4128 credits',
      mediaTaskCount: 3,
      totalMaxFrozenCost: 3.4128,
      costLabel: '3.41',
    })
  })

  it('keeps hidden-credit quotes explicit without inventing a price', () => {
    const hiddenCreditQuote: BillingQuoteView = {
      showCredits: false,
      billingMode: 'ENFORCE',
      billable: true,
      taskCount: 3,
      mediaTaskCount: 3,
      items: [],
    }
    const preview = buildBillingActionQuotePreviewFromQuote({
      quote: hiddenCreditQuote,
      withCredits: ({ count, cost }) => `${count} tasks · ${cost} credits`,
      withoutCredits: ({ count }) => `${count} tasks will be submitted`,
    })

    expect(preview).toEqual({
      fullLabel: '3 tasks will be submitted',
      mediaTaskCount: 3,
    })
  })

  it('formats button cost as a compact suffix', () => {
    expect(formatBillingActionCost(1.1376)).toBe('1.14')
    expect(formatBillingActionCost(2)).toBe('2')
  })
})
