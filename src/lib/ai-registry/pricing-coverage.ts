import { listApiConfigCatalogModels } from './api-config-catalog'
import { findBuiltinPricingCatalogEntry, type PricingApiType } from './pricing-catalog'
import { PLATFORM_MODEL_INPUTS } from './platform-models'
import type { UnifiedModelType } from './types'

/**
 * Every model a user can pick must have a price.
 *
 * Model identity is declared across four independent surfaces — capabilities,
 * pricing, API config and platform presets — joined only by the
 * `(type, provider, modelId)` triple. Nothing type-checks that join, so a model
 * can be offered in the picker while having no pricing entry; it then fails at
 * billing time with `BILLING_UNKNOWN_MODEL`, after the user has already chosen
 * it. This check closes that gap at catalog registration instead.
 */

function modelTypeToPricingApiType(modelType: UnifiedModelType): PricingApiType {
  return modelType === 'llm' ? 'text' : modelType
}

export interface UnpricedSelectableModel {
  readonly surface: 'api-config' | 'platform-preset'
  readonly modelType: UnifiedModelType
  readonly provider: string
  readonly modelId: string
}

export function findUnpricedSelectableModels(): UnpricedSelectableModel[] {
  const missing: UnpricedSelectableModel[] = []

  const seen = new Set<string>()
  const check = (
    surface: UnpricedSelectableModel['surface'],
    modelType: UnifiedModelType,
    provider: string,
    modelId: string,
  ): void => {
    const key = `${surface}::${modelType}::${provider}::${modelId}`
    if (seen.has(key)) return
    seen.add(key)
    const apiType = modelTypeToPricingApiType(modelType)
    if (findBuiltinPricingCatalogEntry(apiType, provider, modelId)) return
    missing.push({ surface, modelType, provider, modelId })
  }

  for (const model of listApiConfigCatalogModels()) {
    check('api-config', model.type, model.provider, model.modelId)
  }
  for (const preset of PLATFORM_MODEL_INPUTS) {
    check('platform-preset', preset.type, preset.provider, preset.modelId)
  }

  return missing
}

export function assertEverySelectableModelIsPriced(): void {
  const missing = findUnpricedSelectableModels()
  if (missing.length === 0) return
  const detail = missing
    .map((model) => `${model.surface} ${model.modelType} ${model.provider}::${model.modelId}`)
    .join('\n')
  throw new Error(
    `PRICING_CATALOG_COVERAGE_MISSING: ${missing.length} selectable model(s) have no price:\n${detail}`,
  )
}
