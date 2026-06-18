import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  buildMediaOptionSchema,
  nonEmptyStringValidator,
} from '@/lib/ai-providers/shared/option-schema'
import {
  CODEX_DEFAULT_IMAGE_MODEL_ID,
  CODEX_DEFAULT_IMAGE_MODEL_KEY,
  CODEX_DEFAULT_MODEL_ID,
  CODEX_DEFAULT_MODEL_KEY,
  CODEX_PROVIDER_KEY,
} from './constants'

export const CODEX_PLATFORM_MODEL_PRESETS = [
  { provider: CODEX_PROVIDER_KEY, modelId: CODEX_DEFAULT_MODEL_ID, name: 'Codex GPT 5.5', type: 'llm' },
  { provider: CODEX_PROVIDER_KEY, modelId: CODEX_DEFAULT_IMAGE_MODEL_ID, name: 'Codex GPT Image 2', type: 'image' },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export const CODEX_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'llm',
    provider: CODEX_PROVIDER_KEY,
    modelId: CODEX_DEFAULT_MODEL_ID,
    capabilities: { llm: { reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } },
  },
  {
    modelType: 'image',
    provider: CODEX_PROVIDER_KEY,
    modelId: CODEX_DEFAULT_IMAGE_MODEL_ID,
    capabilities: { image: { resolutionOptions: ['1K', '2K', '4K'] } },
  },
] as const

export const CODEX_API_CONFIG_CATALOG_MODELS = [
  { modelId: CODEX_DEFAULT_MODEL_ID, name: 'Codex GPT 5.5', type: 'llm', provider: CODEX_PROVIDER_KEY },
  { modelId: CODEX_DEFAULT_IMAGE_MODEL_ID, name: 'Codex GPT Image 2', type: 'image', provider: CODEX_PROVIDER_KEY },
] as const

export const CODEX_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'text', provider: CODEX_PROVIDER_KEY, modelId: CODEX_DEFAULT_MODEL_ID, pricing: { mode: 'flat', flatAmount: 0 } },
  { apiType: 'image', provider: CODEX_PROVIDER_KEY, modelId: CODEX_DEFAULT_IMAGE_MODEL_ID, pricing: { mode: 'flat', flatAmount: 0 } },
] as const

export function resolveCodexOptionSchema(modality: 'image'): AiOptionSchema {
  if (modality === 'image') {
    return buildMediaOptionSchema('image', {
      allowedKeys: ['codexModelId'],
      validators: {
        codexModelId: nonEmptyStringValidator(),
      },
    })
  }
  return buildMediaOptionSchema(modality)
}

export {
  CODEX_DEFAULT_IMAGE_MODEL_KEY,
  CODEX_DEFAULT_MODEL_KEY,
}
