import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'
import { buildMediaOptionSchema, enumValidator, type MediaModality } from '@/lib/ai-providers/shared/option-schema'
import { MUSIC_COMPOSITION_PLAN_LIMITS } from '@/lib/music/composition-plan'

export const ELEVENLABS_MUSIC_V2_MODEL_ID = 'music_v2'

export const ELEVENLABS_PLATFORM_MODEL_PRESETS = [
  {
    provider: 'elevenlabs',
    modelId: ELEVENLABS_MUSIC_V2_MODEL_ID,
    name: 'Eleven Music v2',
    type: 'music',
  },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export const ELEVENLABS_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'music',
    provider: 'elevenlabs',
    modelId: ELEVENLABS_MUSIC_V2_MODEL_ID,
    capabilities: {
      music: {
        generationModes: ['composition_plan'],
        compositionPlan: {
          maxChunks: MUSIC_COMPOSITION_PLAN_LIMITS.maxChunks,
          minChunkDurationMs: MUSIC_COMPOSITION_PLAN_LIMITS.minChunkDurationMs,
          maxChunkDurationMs: MUSIC_COMPOSITION_PLAN_LIMITS.maxChunkDurationMs,
          minPlanDurationMs: MUSIC_COMPOSITION_PLAN_LIMITS.minPlanDurationMs,
          maxPlanDurationMs: MUSIC_COMPOSITION_PLAN_LIMITS.maxPlanDurationMs,
          maxPositiveStyles: MUSIC_COMPOSITION_PLAN_LIMITS.maxPositiveStyles,
          maxNegativeStyles: MUSIC_COMPOSITION_PLAN_LIMITS.maxNegativeStyles,
          contextAdherenceOptions: ['low', 'medium', 'high'],
        },
        outputFormatOptions: ['mp3'],
      },
    },
  },
] as const

export const ELEVENLABS_API_CONFIG_CATALOG_MODELS = [
  {
    modelId: ELEVENLABS_MUSIC_V2_MODEL_ID,
    name: 'Eleven Music v2',
    type: 'music',
    provider: 'elevenlabs',
  },
] as const

/** Official ElevenAPI public price: USD $0.15 per generated minute. */
export const ELEVENLABS_BUILTIN_PRICING_CATALOG_ENTRIES = [
  {
    apiType: 'music',
    provider: 'elevenlabs',
    modelId: ELEVENLABS_MUSIC_V2_MODEL_ID,
    cost: {
      mode: 'flat' as const,
      unit: 'per_second' as const,
      flatAmount: usdToCredits(0.15 / 60),
    },
  },
] as const

export function resolveElevenLabsOptionSchema(
  modality: MediaModality,
  modelId: string,
): AiOptionSchema {
  if (modality !== 'music' || modelId !== ELEVENLABS_MUSIC_V2_MODEL_ID) {
    throw new Error(`ELEVENLABS_MODALITY_UNSUPPORTED:${modality}:${modelId}`)
  }
  return buildMediaOptionSchema('music', {
    excludedKeys: [
      'negativePrompt',
      'durationSeconds',
      'vocalMode',
      'genre',
      'mood',
      'bpm',
    ],
    validators: {
      outputFormat: enumValidator(['mp3']),
    },
    normalize: (options) => ({ ...options, outputFormat: options.outputFormat ?? 'mp3' }),
  })
}
