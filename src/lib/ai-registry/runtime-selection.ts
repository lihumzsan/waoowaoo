import { composeModelKey, parseModelKeyStrict } from './selection'
import type { UnifiedModelType } from './types'

export type RuntimeModelMediaType = UnifiedModelType

export interface RuntimeStoredModel {
  modelId: string
  modelKey: string
  name: string
  type: UnifiedModelType
  provider: string
  price: number
}

export interface RuntimeModelSelection {
  provider: string
  modelId: string
  modelKey: string
  mediaType: RuntimeModelMediaType
  variantSubKind: 'official' | 'user-template'
}

export function normalizeProviderRuntimeBaseUrl(providerId: string, rawBaseUrl?: string): string | undefined {
  const baseUrl = typeof rawBaseUrl === 'string' ? rawBaseUrl.trim() : ''
  if (!baseUrl) return undefined
  return baseUrl
}

function assertRuntimeModelKey(value: string, field: string): { provider: string; modelId: string; modelKey: string } {
  const parsed = parseModelKeyStrict(value)
  if (!parsed) {
    throw new Error(`MODEL_KEY_INVALID: ${field} must be provider::modelId`)
  }
  return parsed
}

export function findRuntimeModelByKey(
  models: RuntimeStoredModel[],
  modelKey: string,
): RuntimeStoredModel | null {
  const parsed = assertRuntimeModelKey(modelKey, 'model')
  return models.find((model) => model.modelId === parsed.modelId && model.provider === parsed.provider) || null
}

function buildRuntimeModelSelection(
  model: RuntimeStoredModel,
  mediaType: RuntimeModelMediaType,
): RuntimeModelSelection {
  return {
    provider: model.provider,
    modelId: model.modelId,
    modelKey: composeModelKey(model.provider, model.modelId),
    mediaType,
    variantSubKind: 'official',
  }
}

export function resolveRuntimeModelSelection(
  models: RuntimeStoredModel[],
  modelKey: string,
  mediaType: RuntimeModelMediaType,
): RuntimeModelSelection {
  const parsed = assertRuntimeModelKey(modelKey, `${mediaType} model`)
  const exact = findRuntimeModelByKey(models, parsed.modelKey)
  if (!exact || exact.type !== mediaType) {
    throw new Error(`MODEL_NOT_FOUND: ${parsed.modelKey} is not enabled for ${mediaType}`)
  }
  return buildRuntimeModelSelection(exact, mediaType)
}

export function resolveSingleRuntimeModelSelection(
  models: RuntimeStoredModel[],
  mediaType: RuntimeModelMediaType,
): RuntimeModelSelection {
  const candidates = models.filter((model) => model.type === mediaType)
  if (candidates.length === 0) {
    throw new Error(`MODEL_NOT_CONFIGURED: no ${mediaType} model is enabled`)
  }
  if (candidates.length > 1) {
    throw new Error(`MODEL_SELECTION_REQUIRED: multiple ${mediaType} models are enabled, provide model_key explicitly`)
  }

  const model = candidates[0]
  if (!model) {
    throw new Error(`MODEL_NOT_CONFIGURED: no ${mediaType} model is enabled`)
  }
  return buildRuntimeModelSelection(model, mediaType)
}
