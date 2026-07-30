import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  buildMediaOptionSchema,
  enumValidator,
  integerRangeValidator,
  nonEmptyStringValidator,
  numberRangeValidator,
  type MediaModality,
} from '@/lib/ai-providers/shared/option-schema'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'

export const MUREKA_9_MODEL_ID = 'mureka-9'

/**
 * Mureka soundtrack wire limits (official OpenAPI spec):
 * - soundtrack segment must be at least 3 seconds long;
 * - BGM/instrumental output must not exceed 4m30s (270s).
 * The range constrains one provider request, not creative structure.
 */
export const MUREKA_MUSIC_DURATION_SECONDS_RANGE = { min: 3, max: 270 } as const

/** Official wire limit: soundtrack/instrumental prompts accept at most 1024 characters. */
export const MUREKA_MUSIC_PROMPT_MAX_CHARS = 1024

export const MUREKA_PLATFORM_MODEL_PRESETS = [
  { provider: 'mureka', modelId: MUREKA_9_MODEL_ID, name: 'Mureka V9', type: 'music' },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export const MUREKA_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'music',
    provider: 'mureka',
    modelId: MUREKA_9_MODEL_ID,
    capabilities: {
      music: {
        durationSecondsRange: {
          min: MUREKA_MUSIC_DURATION_SECONDS_RANGE.min,
          max: MUREKA_MUSIC_DURATION_SECONDS_RANGE.max,
        },
        vocalModeOptions: ['instrumental'],
        outputFormatOptions: ['mp3'],
        maxReferenceVideos: 1,
        promptMaxChars: MUREKA_MUSIC_PROMPT_MAX_CHARS,
      },
    },
  },
] as const

export const MUREKA_API_CONFIG_CATALOG_MODELS = [
  { modelId: MUREKA_9_MODEL_ID, name: 'Mureka V9', type: 'music', provider: 'mureka' },
] as const

// Mureka does not publish a per-generation USD price in its public docs; the
// authoritative number lives in the account billing console. This entry uses
// the provisionally confirmed per-call price and must track the real console
// figure before production billing relies on it.
export const MUREKA_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'music', provider: 'mureka', modelId: MUREKA_9_MODEL_ID, pricing: { mode: 'flat' as const, flatAmount: usdToCredits(0.06) } },
] as const

export function resolveMurekaOptionSchema(modality: MediaModality, modelId: string): AiOptionSchema {
  if (modality !== 'music' || modelId !== MUREKA_9_MODEL_ID) {
    throw new Error(`MUREKA_MODALITY_UNSUPPORTED:${modality}:${modelId}`)
  }
  return buildMediaOptionSchema('music', {
    allowedKeys: ['referenceVideoUrl', 'referenceVideoDurationMs'],
    validators: {
      negativePrompt: nonEmptyStringValidator(),
      durationSeconds: numberRangeValidator(MUREKA_MUSIC_DURATION_SECONDS_RANGE),
      vocalMode: enumValidator(['instrumental']),
      genre: nonEmptyStringValidator(),
      mood: nonEmptyStringValidator(),
      bpm: integerRangeValidator({ min: 20, max: 300 }),
      outputFormat: enumValidator(['mp3']),
      referenceVideoUrl: nonEmptyStringValidator(),
      referenceVideoDurationMs: integerRangeValidator({ min: 1 }),
    },
  })
}
