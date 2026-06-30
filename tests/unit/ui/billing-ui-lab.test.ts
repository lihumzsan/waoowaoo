import { describe, expect, it } from 'vitest'
import {
  BILLING_UI_LAB_VARIANT_IDS,
  getBillingUiLabCopy,
  getBillingUiLabVariant,
} from '@/app/[locale]/billing-ui-lab/billing-ui-lab-data'

describe('billing UI lab copy', () => {
  it('defines exactly five review variants for every locale', () => {
    for (const locale of ['zh', 'en'] as const) {
      const copy = getBillingUiLabCopy(locale)

      expect(copy.variants.map((variant) => variant.id)).toEqual(BILLING_UI_LAB_VARIANT_IDS)
      expect(copy.variants).toHaveLength(5)
      expect(copy.quote.credits).toBe('3.4128')
      expect(copy.quote.mediaTasks).toBe('3')
    }
  })

  it('keeps the requested inline icon plus number action variant available', () => {
    const variant = getBillingUiLabVariant('inline-action-metrics', 'zh')

    expect(variant.icon).toBe('coins')
    expect(variant.title).toContain('按钮')
    expect(variant.subtitle).toContain('icon + 数字')
  })
})
