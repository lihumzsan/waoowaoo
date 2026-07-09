import { composeModelKey } from '@/lib/ai-registry/selection'
import type { ModelCapabilities, UnifiedModelType } from '@/lib/ai-registry/types'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { listBuiltinPricingCatalog, type PricingApiType } from '@/lib/ai-registry/pricing-catalog'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import type { PricingDisplayMap, PricingDisplayItem, StoredModel } from './api-config-types'
import { getProviderKey } from './api-config-shared'

export function formatPriceAmount(amount: number): string {
  const fixed = amount.toFixed(4)
  const normalized = fixed.replace(/\.?0+$/, '')
  return normalized || '0'
}

function pricingApiTypeToModelType(apiType: PricingApiType): UnifiedModelType | null {
  if (apiType === 'text') return 'llm'
  if (apiType === 'image') return 'image'
  if (apiType === 'video') return 'video'
  if (apiType === 'music') return 'music'
  if (apiType === 'sound_effect') return 'soundEffect'
  return null
}

function composePricingDisplayKey(modelType: UnifiedModelType, provider: string, modelId: string): string {
  return `${modelType}::${provider}::${modelId}`
}

export function resolveBuiltinCapabilities(modelType: UnifiedModelType, provider: string, modelId: string): ModelCapabilities | undefined {
  const modelKey = composeModelKey(provider, modelId)
  if (!modelKey) return undefined
  return resolveBuiltinCapabilitiesByModelKey(modelType, modelKey)
}

function resolveVideoDurationRangeFromCapabilities(
  provider: string,
  modelId: string,
): { min: number; max: number } | null {
  const capabilities = resolveBuiltinCapabilities('video', provider, modelId)
  const options = capabilities?.video?.durationOptions
  if (!Array.isArray(options) || options.length === 0) return null

  const durations = options.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (durations.length === 0) return null
  return {
    min: Math.min(...durations),
    max: Math.max(...durations),
  }
}

function applyVideoDurationRangeIfNeeded(input: {
  apiType: PricingApiType
  provider: string
  modelId: string
  min: number
  max: number
  unit?: 'per_call' | 'per_second'
}): { min: number; max: number } {
  if (input.apiType !== 'video') return { min: input.min, max: input.max }
  if (input.unit !== 'per_second') return { min: input.min, max: input.max }

  const durationRange = resolveVideoDurationRangeFromCapabilities(input.provider, input.modelId)
  if (!durationRange) return { min: input.min, max: input.max }

  const scaledMin = input.min * durationRange.min
  const scaledMax = input.max * durationRange.max
  return {
    min: scaledMin,
    max: scaledMax,
  }
}

export function buildPricingDisplayMap(): PricingDisplayMap {
  const map: PricingDisplayMap = {}
  const entries = listBuiltinPricingCatalog()

  for (const entry of entries) {
    const modelType = pricingApiTypeToModelType(entry.apiType)
    if (!modelType) continue

    let min = 0
    let max = 0
    let input: number | undefined
    let output: number | undefined
    if (entry.pricing.mode === 'flat') {
      const amount = entry.pricing.flatAmount ?? 0
      min = amount
      max = amount
    } else {
      const tiers = entry.pricing.tiers || []
      const amounts = tiers.map((tier) => tier.amount)
      if (amounts.length === 0) continue

      const durationExpanded = applyVideoDurationRangeIfNeeded({
        apiType: entry.apiType,
        provider: entry.provider,
        modelId: entry.modelId,
        min: Math.min(...amounts),
        max: Math.max(...amounts),
        unit: entry.pricing.unit,
      })
      min = durationExpanded.min
      max = durationExpanded.max

      if (entry.apiType === 'text') {
        for (const tier of tiers) {
          const tokenType = tier.when.tokenType
          if (tokenType === 'input') input = tier.amount
          if (tokenType === 'output') output = tier.amount
        }
      }
    }

    map[composePricingDisplayKey(modelType, entry.provider, entry.modelId)] = {
      min,
      max,
      label: min === max
        ? formatPriceAmount(min)
        : `${formatPriceAmount(min)}~${formatPriceAmount(max)}`,
      ...(typeof input === 'number' ? { input } : {}),
      ...(typeof output === 'number' ? { output } : {}),
    }
  }

  return map
}

function resolvePricingDisplayItem(
  map: PricingDisplayMap,
  modelType: UnifiedModelType,
  provider: string,
  modelId: string,
): PricingDisplayItem | null {
  const exact = map[composePricingDisplayKey(modelType, provider, modelId)]
  if (exact) return exact

  const providerKey = getProviderKey(provider)
  if (providerKey !== provider) {
    const fallback = map[composePricingDisplayKey(modelType, providerKey, modelId)]
    if (fallback) return fallback
  }

  return null
}

export function withDisplayPricing(model: StoredModel, map: PricingDisplayMap): StoredModel {
  const display = resolvePricingDisplayItem(map, model.type, model.provider, model.modelId)
  if (!display) {
    return {
      ...model,
      price: 0,
      priceLabel: '--',
      priceMin: undefined,
      priceMax: undefined,
    }
  }

  return {
    ...model,
    price: display.min,
    priceMin: display.min,
    priceMax: display.max,
    priceLabel: display.label,
    ...(typeof display.input === 'number' ? { priceInput: display.input } : {}),
    ...(typeof display.output === 'number' ? { priceOutput: display.output } : {}),
  }
}
ensureAiCatalogsRegistered()
