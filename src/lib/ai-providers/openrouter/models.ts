import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  booleanValidator,
  buildMediaOptionSchema,
  enumValidator,
  integerRangeValidator,
  type MediaModality,
} from '@/lib/ai-providers/shared/option-schema'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'
import type { ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'

export const OPENROUTER_PROVIDER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
export const OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID = 'openai/gpt-4o-mini'
export const OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID = 'bytedance/seedance-2.0'
export const OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID = 'bytedance/seedance-2.0-fast'
export const OPENROUTER_GEMINI_3_5_FLASH_MODEL_ID = 'google/gemini-3.5-flash'
export const OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID = 'anthropic/claude-sonnet-4.6'
export const OPENROUTER_GPT_5_5_MODEL_ID = 'openai/gpt-5.5'
export const OPENROUTER_GPT_5_6_LUNA_MODEL_ID = 'openai/gpt-5.6-luna'
export const OPENROUTER_GPT_5_6_TERRA_MODEL_ID = 'openai/gpt-5.6-terra'
export const OPENROUTER_GPT_5_6_SOL_MODEL_ID = 'openai/gpt-5.6-sol'
export const OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY = `openrouter::${OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID}`
export const OPENROUTER_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY = `openrouter::${OPENROUTER_GPT_5_5_MODEL_ID}`
export const OPENROUTER_PLATFORM_DEFAULT_VIDEO_MODEL_KEY = `openrouter::${OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID}`

export const OPENROUTER_VIDEO_MODEL_IDS = new Set([
  OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID,
  OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
])

const OPENROUTER_SEEDANCE_2_DURATION_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const
const OPENROUTER_SEEDANCE_2_RESOLUTION_OPTIONS = ['480p', '720p', '1080p'] as const
const OPENROUTER_SEEDANCE_2_FAST_RESOLUTION_OPTIONS = ['480p', '720p'] as const
export const OPENROUTER_SEEDANCE_2_ASPECT_RATIO_OPTIONS = ['1:1', '3:4', '9:16', '4:3', '16:9', '21:9', '9:21'] as const
export const OPENROUTER_GPT_5_6_REASONING_EFFORT_OPTIONS = [
  'medium',
  'low',
  'high',
  'xhigh',
  'max',
  'none',
] as const satisfies readonly ReasoningEffort[]

function openrouterTokenPricing(inputUsdPerMillion: number, outputUsdPerMillion: number) {
  return {
    mode: 'capability' as const,
    tiers: [
      { when: { tokenType: 'input' }, amount: usdToCredits(inputUsdPerMillion) },
      { when: { tokenType: 'output' }, amount: usdToCredits(outputUsdPerMillion) },
    ],
  }
}

function openrouterVideoSecondPricing(tiers: ReadonlyArray<readonly [resolution: string, amountUsdPerSecond: number]>) {
  return {
    mode: 'capability' as const,
    unit: 'per_second' as const,
    tiers: tiers.map(([resolution, amountUsdPerSecond]) => ({
      when: { resolution },
      amount: usdToCredits(amountUsdPerSecond),
    })),
  }
}

export const OPENROUTER_BUILTIN_PRICING_CATALOG_ENTRIES = [
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'google/gemini-3.1-pro-preview',
    pricing: openrouterTokenPricing(1.25, 10),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'google/gemini-3-pro-preview',
    pricing: openrouterTokenPricing(1.25, 10),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: OPENROUTER_GEMINI_3_5_FLASH_MODEL_ID,
    pricing: openrouterTokenPricing(1.5, 9),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID,
    pricing: openrouterTokenPricing(3, 15),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4.5',
    pricing: openrouterTokenPricing(3, 15),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4',
    pricing: openrouterTokenPricing(3, 15),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: OPENROUTER_GPT_5_5_MODEL_ID,
    pricing: openrouterTokenPricing(5, 30),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: OPENROUTER_GPT_5_6_LUNA_MODEL_ID,
    pricing: openrouterTokenPricing(1, 6),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: OPENROUTER_GPT_5_6_TERRA_MODEL_ID,
    pricing: openrouterTokenPricing(2.5, 15),
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: OPENROUTER_GPT_5_6_SOL_MODEL_ID,
    pricing: openrouterTokenPricing(5, 30),
  },
  {
    apiType: 'video',
    provider: 'openrouter',
    modelId: OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID,
    pricing: openrouterVideoSecondPricing([
      ['480p', 0.06726],
      ['720p', 0.151335],
      ['1080p', 0.3405386],
    ]),
  },
  {
    apiType: 'video',
    provider: 'openrouter',
    modelId: OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
    pricing: openrouterVideoSecondPricing([
      ['480p', 0.0538],
      ['720p', 0.12105],
    ]),
  },
] as const

export const OPENROUTER_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID, capabilities: { llm: { protocol: 'openrouter-chat' } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'google/gemini-3.1-pro-preview', capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'google/gemini-3-pro-preview', capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_GEMINI_3_5_FLASH_MODEL_ID, capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'google/gemini-3.1-flash-lite-preview', capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID, capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5', capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4', capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_GPT_5_5_MODEL_ID, capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_GPT_5_6_LUNA_MODEL_ID, capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: [...OPENROUTER_GPT_5_6_REASONING_EFFORT_OPTIONS] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_GPT_5_6_TERRA_MODEL_ID, capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: [...OPENROUTER_GPT_5_6_REASONING_EFFORT_OPTIONS] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_GPT_5_6_SOL_MODEL_ID, capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: [...OPENROUTER_GPT_5_6_REASONING_EFFORT_OPTIONS] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'openai/gpt-5.4', capabilities: { llm: { protocol: 'openrouter-chat', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } } },
  {
    modelType: 'video',
    provider: 'openrouter',
    modelId: OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [...OPENROUTER_SEEDANCE_2_DURATION_OPTIONS],
        resolutionOptions: [...OPENROUTER_SEEDANCE_2_RESOLUTION_OPTIONS],
        firstlastframe: true,
        supportGenerateAudio: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'openrouter',
    modelId: OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [...OPENROUTER_SEEDANCE_2_DURATION_OPTIONS],
        resolutionOptions: [...OPENROUTER_SEEDANCE_2_FAST_RESOLUTION_OPTIONS],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 8,
      },
    },
  },
] as const

export const OPENROUTER_API_CONFIG_CATALOG_MODELS = [
  { modelId: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', type: 'llm', provider: 'openrouter' },
  { modelId: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_GEMINI_3_5_FLASH_MODEL_ID, name: 'Gemini 3.5 Flash', type: 'llm', provider: 'openrouter' },
  { modelId: 'google/gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID, name: 'Claude Sonnet 4.6', type: 'llm', provider: 'openrouter' },
  { modelId: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', type: 'llm', provider: 'openrouter' },
  { modelId: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_GPT_5_5_MODEL_ID, name: 'GPT-5.5', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_GPT_5_6_LUNA_MODEL_ID, name: 'GPT-5.6 Luna', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_GPT_5_6_TERRA_MODEL_ID, name: 'GPT-5.6 Terra', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_GPT_5_6_SOL_MODEL_ID, name: 'GPT-5.6 Sol', type: 'llm', provider: 'openrouter' },
  { modelId: 'openai/gpt-5.4', name: 'GPT-5.4', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID, name: 'Seedance 2.0', type: 'video', provider: 'openrouter' },
  { modelId: OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID, name: 'Seedance 2.0 Fast', type: 'video', provider: 'openrouter' },
] as const

export const OPENROUTER_PLATFORM_MODEL_PRESETS = [
  { provider: 'openrouter', modelId: OPENROUTER_GEMINI_3_5_FLASH_MODEL_ID, name: 'Gemini 3.5 Flash', type: 'llm' },
  { provider: 'openrouter', modelId: OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID, name: 'Claude Sonnet 4.6', type: 'llm' },
  { provider: 'openrouter', modelId: OPENROUTER_GPT_5_5_MODEL_ID, name: 'GPT-5.5', type: 'llm' },
  { provider: 'openrouter', modelId: OPENROUTER_GPT_5_6_LUNA_MODEL_ID, name: 'GPT-5.6 Luna', type: 'llm' },
  { provider: 'openrouter', modelId: OPENROUTER_GPT_5_6_TERRA_MODEL_ID, name: 'GPT-5.6 Terra', type: 'llm' },
  { provider: 'openrouter', modelId: OPENROUTER_GPT_5_6_SOL_MODEL_ID, name: 'GPT-5.6 Sol', type: 'llm' },
  { provider: 'openrouter', modelId: OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID, name: 'Seedance 2.0', type: 'video' },
  { provider: 'openrouter', modelId: OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID, name: 'Seedance 2.0 Fast', type: 'video' },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export function resolveOpenRouterOptionSchema(modality: MediaModality, modelId?: string): AiOptionSchema {
  if (modality === 'video') {
    return buildMediaOptionSchema('video', {
      allowedKeys: ['referenceImages'],
      validators: {
        duration: integerRangeValidator({ min: 4, max: 15 }),
        aspectRatio: enumValidator(OPENROUTER_SEEDANCE_2_ASPECT_RATIO_OPTIONS),
        resolution: enumValidator(
          modelId === OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID
            ? OPENROUTER_SEEDANCE_2_FAST_RESOLUTION_OPTIONS
            : OPENROUTER_SEEDANCE_2_RESOLUTION_OPTIONS,
        ),
        generateAudio: booleanValidator(),
      },
    })
  }
  return buildMediaOptionSchema(modality)
}
