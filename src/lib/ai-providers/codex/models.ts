import { CODEX_DEFAULT_IMAGE_MODEL_ID } from './constants'
import type { PlatformModelPreset } from '@/lib/platform-models/types'

export const CODEX_API_CONFIG_CATALOG_MODELS = [
  { modelId: CODEX_DEFAULT_IMAGE_MODEL_ID, name: 'Codex Image', type: 'image', provider: 'codex' },
] as const

export const CODEX_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'image',
    provider: 'codex',
    modelId: CODEX_DEFAULT_IMAGE_MODEL_ID,
    capabilities: {
      image: {
        resolutionOptions: ['1K', '2K', '4K'],
        qualityOptions: ['low', 'medium', 'high'],
      },
    },
  },
] as const

export const CODEX_PLATFORM_MODEL_PRESETS: readonly PlatformModelPreset[] = [
  { provider: 'codex', modelId: CODEX_DEFAULT_IMAGE_MODEL_ID, name: 'Codex Image', type: 'image' },
]

export const CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY = `codex::${CODEX_DEFAULT_IMAGE_MODEL_ID}`
