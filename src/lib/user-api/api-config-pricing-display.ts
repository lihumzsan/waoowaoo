import { composeModelKey } from '@/lib/ai-registry/selection'
import type { ModelCapabilities, UnifiedModelType } from '@/lib/ai-registry/types'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import type { PricingDisplayMap, StoredModel } from './api-config-types'

export function resolveBuiltinCapabilities(modelType: UnifiedModelType, provider: string, modelId: string): ModelCapabilities | undefined {
  const modelKey = composeModelKey(provider, modelId)
  return modelKey ? resolveBuiltinCapabilitiesByModelKey(modelType, modelKey) : undefined
}

/** Product is permanently free; retain the response shape for old clients with neutral values. */
export function buildPricingDisplayMap(): PricingDisplayMap { return {} }

export function withDisplayPricing(model: StoredModel, _map: PricingDisplayMap): StoredModel {
  return { ...model, price: 0, priceLabel: '--', priceMin: undefined, priceMax: undefined }
}
