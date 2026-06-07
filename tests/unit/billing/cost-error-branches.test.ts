import { beforeEach, describe, expect, it, vi } from 'vitest'

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


import { calcImage, calcMusic, calcText, calcVideo } from '@/lib/billing/cost'

describe('billing/cost error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores ambiguous provider pricing because product credits own pricing', () => {
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

    expect(calcImage('shared-model', 1)).toBe(1)
    expect(lookupMock.resolveBuiltinPricing).not.toHaveBeenCalled()
  })

  it('charges unknown models from product credits without catalog fallback', () => {
    lookupMock.resolveBuiltinPricing.mockReturnValue({
      status: 'not_configured',
    })

    expect(calcImage('provider::missing-image-model', 1)).toBe(1)
    expect(lookupMock.resolveBuiltinPricing).not.toHaveBeenCalled()
  })

  it('normalizes invalid numeric inputs before product credit pricing', () => {
    lookupMock.resolveBuiltinPricing.mockImplementation(
      (input: { selections?: { tokenType?: 'input' | 'output' } }) => {
        if (input.selections?.tokenType === 'input') return { status: 'resolved', amount: 2 }
        if (input.selections?.tokenType === 'output') return { status: 'resolved', amount: 4 }
        return { status: 'resolved', amount: 3 }
      },
    )

    expect(calcText('text-model', Number.NaN, 1_000_000)).toBeCloseTo(10, 8)
    expect(calcText('text-model', 1_000_000, Number.NaN)).toBeCloseTo(10, 8)
    expect(calcImage('image-model', Number.NaN)).toBe(1)
    expect(calcVideo('video-model', '720p', Number.NaN)).toBe(5)
    expect(calcMusic('music-model', Number.NaN)).toBe(0)
  })
})
