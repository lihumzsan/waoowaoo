import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  booleanValidator,
  buildMediaOptionSchema,
  enumValidator,
  integerRangeValidator,
  type MediaModality,
} from '@/lib/ai-providers/shared/option-schema'

export const OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID = 'bytedance/seedance-2.0'
export const OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID = 'bytedance/seedance-2.0-fast'
export const OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID = 'anthropic/claude-sonnet-4.6'
export const OPENROUTER_GPT_5_5_MODEL_ID = 'openai/gpt-5.5'
export const OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY = `openrouter::${OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID}`
export const OPENROUTER_PLATFORM_DEFAULT_VIDEO_MODEL_KEY = `openrouter::${OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID}`

export const OPENROUTER_VIDEO_MODEL_IDS = new Set([
  OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID,
  OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
])

const OPENROUTER_SEEDANCE_2_DURATION_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const
const OPENROUTER_SEEDANCE_2_RESOLUTION_OPTIONS = ['480p', '720p', '1080p'] as const
const OPENROUTER_SEEDANCE_2_FAST_RESOLUTION_OPTIONS = ['480p', '720p'] as const
export const OPENROUTER_SEEDANCE_2_ASPECT_RATIO_OPTIONS = ['1:1', '3:4', '9:16', '4:3', '16:9', '21:9', '9:21'] as const

export const OPENROUTER_BUILTIN_PRICING_CATALOG_ENTRIES = [
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'google/gemini-3.1-pro-preview',
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { tokenType: 'input' }, amount: 9 },
        { when: { tokenType: 'output' }, amount: 72 },
      ],
    },
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'google/gemini-3-pro-preview',
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { tokenType: 'input' }, amount: 9 },
        { when: { tokenType: 'output' }, amount: 72 },
      ],
    },
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'google/gemini-3-flash-preview',
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { tokenType: 'input' }, amount: 0.54 },
        { when: { tokenType: 'output' }, amount: 2.16 },
      ],
    },
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID,
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { tokenType: 'input' }, amount: 21.6 },
        { when: { tokenType: 'output' }, amount: 108 },
      ],
    },
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4.5',
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { tokenType: 'input' }, amount: 21.6 },
        { when: { tokenType: 'output' }, amount: 108 },
      ],
    },
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4',
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { tokenType: 'input' }, amount: 21.6 },
        { when: { tokenType: 'output' }, amount: 108 },
      ],
    },
  },
  {
    apiType: 'text',
    provider: 'openrouter',
    modelId: OPENROUTER_GPT_5_5_MODEL_ID,
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { tokenType: 'input' }, amount: 36 },
        { when: { tokenType: 'output' }, amount: 216 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'openrouter',
    modelId: OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID,
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { resolution: '480p' }, amount: 0.3329 },
        { when: { resolution: '720p' }, amount: 0.7489 },
        { when: { resolution: '1080p' }, amount: 1.684 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'openrouter',
    modelId: OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { resolution: '480p' }, amount: 0.2663 },
        { when: { resolution: '720p' }, amount: 0.5991 },
      ],
    },
  },
] as const

export const OPENROUTER_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  { modelType: 'llm', provider: 'openrouter', modelId: 'google/gemini-3.1-pro-preview', capabilities: { llm: { reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'google/gemini-3-pro-preview', capabilities: { llm: { reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'google/gemini-3-flash-preview', capabilities: { llm: { reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID, capabilities: { llm: { reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5', capabilities: { llm: { reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4', capabilities: { llm: { reasoningEffortOptions: ['low', 'medium', 'high'] } } },
  { modelType: 'llm', provider: 'openrouter', modelId: OPENROUTER_GPT_5_5_MODEL_ID, capabilities: { llm: { reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } } },
  {
    modelType: 'video',
    provider: 'openrouter',
    modelId: OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID,
    capabilities: {
      video: {
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
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [...OPENROUTER_SEEDANCE_2_DURATION_OPTIONS],
        resolutionOptions: [...OPENROUTER_SEEDANCE_2_FAST_RESOLUTION_OPTIONS],
        firstlastframe: true,
        supportGenerateAudio: true,
      },
    },
  },
] as const

export const OPENROUTER_API_CONFIG_CATALOG_MODELS = [
  { modelId: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', type: 'llm', provider: 'openrouter' },
  { modelId: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', type: 'llm', provider: 'openrouter' },
  { modelId: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', type: 'llm', provider: 'openrouter' },
  { modelId: 'google/gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID, name: 'Claude Sonnet 4.6', type: 'llm', provider: 'openrouter' },
  { modelId: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', type: 'llm', provider: 'openrouter' },
  { modelId: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_GPT_5_5_MODEL_ID, name: 'GPT-5.5', type: 'llm', provider: 'openrouter' },
  { modelId: 'openai/gpt-5.4', name: 'GPT-5.4', type: 'llm', provider: 'openrouter' },
  { modelId: OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID, name: 'Seedance 2.0', type: 'video', provider: 'openrouter' },
  { modelId: OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID, name: 'Seedance 2.0 Fast', type: 'video', provider: 'openrouter' },
] as const

export const OPENROUTER_PLATFORM_MODEL_PRESETS = [
  { provider: 'openrouter', modelId: OPENROUTER_CLAUDE_SONNET_4_6_MODEL_ID, name: 'Claude Sonnet 4.6', type: 'llm' },
  { provider: 'openrouter', modelId: OPENROUTER_GPT_5_5_MODEL_ID, name: 'GPT-5.5', type: 'llm' },
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
