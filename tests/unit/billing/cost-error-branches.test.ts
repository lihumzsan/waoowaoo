import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PricingResolution } from '@/lib/ai-registry/pricing-resolution'

type PricingLookupInput = {
  apiType: string
  model: string
  selections?: Record<string, string | number | boolean>
}

const lookupMock = vi.hoisted(() => ({
  resolveBuiltinPricing: vi.fn(),
  listBuiltinCapabilityCatalog: vi.fn(() => []),
  findBuiltinCapabilities: vi.fn(() => undefined),
  registerBuiltinCapabilityCatalogEntries: vi.fn(),
  registerBuiltinPricingCatalogEntries: vi.fn(),
  registerBuiltinApiConfigCatalog: vi.fn(),
  validateCapabilitySelectionForModel: vi.fn(() => []),
}))

vi.mock('@/lib/ai-registry/capabilities-catalog', () => ({
  listBuiltinCapabilityCatalog: lookupMock.listBuiltinCapabilityCatalog,
  findBuiltinCapabilities: lookupMock.findBuiltinCapabilities,
  registerBuiltinCapabilityCatalogEntries: lookupMock.registerBuiltinCapabilityCatalogEntries,
  validateCapabilitySelectionForModel: lookupMock.validateCapabilitySelectionForModel,
}))

vi.mock('@/lib/ai-registry/api-config-catalog', () => ({
  registerBuiltinApiConfigCatalog: lookupMock.registerBuiltinApiConfigCatalog,
}))

vi.mock('@/lib/ai-registry/pricing-resolution', () => ({
  resolveBuiltinPricing: lookupMock.resolveBuiltinPricing,
}))

vi.mock('@/lib/ai-registry/pricing-catalog', () => ({
  registerBuiltinPricingCatalogEntries: lookupMock.registerBuiltinPricingCatalogEntries,
}))

import { calcImage, calcText, calcVideo } from '@/lib/billing/cost'

function resolvedFlat(amount: number): PricingResolution {
  return {
    status: 'resolved',
    amount,
    mode: 'flat',
    entry: {
      apiType: 'image',
      provider: 'provider',
      modelId: 'model',
      pricing: { mode: 'flat', flatAmount: amount },
    },
  }
}

describe('billing/cost error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails ambiguous provider pricing instead of falling back to product credits', () => {
    lookupMock.resolveBuiltinPricing.mockReturnValue({
      status: 'ambiguous_model',
      apiType: 'image',
      modelId: 'shared-model',
      candidates: [
        {
          apiType: 'image',
          provider: 'p1',
          modelId: 'shared-model',
          pricing: { mode: 'flat', flatAmount: 1 },
        },
        {
          apiType: 'image',
          provider: 'p2',
          modelId: 'shared-model',
          pricing: { mode: 'flat', flatAmount: 1 },
        },
      ],
    })

    expect(() => calcImage('shared-model', 1)).toThrow(/BILLING_PRICING_MODEL_AMBIGUOUS/)
    expect(lookupMock.resolveBuiltinPricing).toHaveBeenCalledOnce()
  })

  it('fails unknown models without catalog pricing', () => {
    lookupMock.resolveBuiltinPricing.mockReturnValue({
      status: 'not_configured',
    })

    expect(() => calcImage('provider::missing-image-model', 1)).toThrow(/BILLING_UNKNOWN_MODEL/)
    expect(lookupMock.resolveBuiltinPricing).toHaveBeenCalledOnce()
  })

  it('fails capability-priced models when selections do not match a tier', () => {
    lookupMock.resolveBuiltinPricing.mockReturnValue({
      status: 'missing_capability_match',
      selections: { resolution: '8K' },
      entry: {
        apiType: 'image',
        provider: 'provider',
        modelId: 'image-model',
        pricing: {
          mode: 'capability',
          tiers: [{ when: { resolution: '1K' }, amount: 1 }],
        },
      },
    })

    expect(() => calcImage('provider::image-model', 1, { resolution: '8K' })).toThrow(/BILLING_CAPABILITY_PRICE_NOT_FOUND/)
  })

  it('normalizes invalid token inputs before resolving provider pricing', () => {
    lookupMock.resolveBuiltinPricing.mockImplementation((input: PricingLookupInput): PricingResolution => {
      if (input.selections?.tokenType === 'input') {
        return {
          status: 'resolved',
          amount: 2,
          mode: 'capability',
          entry: {
            apiType: 'text',
            provider: 'provider',
            modelId: 'text-model',
            pricing: { mode: 'capability', tiers: [{ when: { tokenType: 'input' }, amount: 2 }] },
          },
          tier: { when: { tokenType: 'input' }, amount: 2 },
        }
      }
      return {
        status: 'resolved',
        amount: 4,
        mode: 'capability',
        entry: {
          apiType: 'text',
          provider: 'provider',
          modelId: 'text-model',
          pricing: { mode: 'capability', tiers: [{ when: { tokenType: 'output' }, amount: 4 }] },
        },
        tier: { when: { tokenType: 'output' }, amount: 4 },
      }
    })

    expect(calcText('text-model', Number.NaN, 1_000_000)).toBeCloseTo(4, 8)
    expect(calcText('text-model', 1_000_000, Number.NaN)).toBeCloseTo(2, 8)
  })

  it('requires duration for per-second video catalog prices', () => {
    lookupMock.resolveBuiltinPricing.mockReturnValue({
      status: 'resolved',
      amount: 0.5,
      mode: 'capability',
      entry: {
        apiType: 'video',
        provider: 'provider',
        modelId: 'video-model',
        pricing: {
          mode: 'capability',
          unit: 'per_second',
          tiers: [{ when: { resolution: '720p' }, amount: 0.5 }],
        },
      },
      tier: { when: { resolution: '720p' }, amount: 0.5 },
    })

    expect(() => calcVideo('provider::video-model', '720p', 1)).toThrow(/BILLING_CAPABILITY_PRICE_NOT_FOUND/)
    expect(calcVideo('provider::video-model', '720p', 1, { duration: 5 })).toBeCloseTo(2.5, 8)
  })

  it('normalizes media quantity while still using provider catalog price', () => {
    lookupMock.resolveBuiltinPricing.mockReturnValue(resolvedFlat(3))

    expect(calcImage('provider::image-model', Number.NaN)).toBe(3)
  })
})
