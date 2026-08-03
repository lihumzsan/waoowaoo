import type { MediaOptionSchemaConfig } from '@/lib/ai-providers/shared/media-option-schema-config'
import { SEEDANCE_2_RETAIL_CREDITS_PER_SECOND } from '@/lib/ai-providers/shared/seedance-pricing'
import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  buildMediaOptionSchema,
  enumValidator,
  integerRangeValidator,
  nonEmptyStringValidator,
  stringArrayValidator,
  type MediaModality,
} from '@/lib/ai-providers/shared/option-schema'

export const ARK_IMAGE_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'] as const
export const ARK_VIDEO_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] as const
export const ARK_IMAGE_RESOLUTIONS = ['4K', '3K'] as const
export const ARK_VIDEO_SERVICE_TIERS = ['default', 'flex'] as const
export const ARK_PROVIDER_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const ARK_PROVIDER_TEST_LLM_MODEL_ID = 'doubao-seed-2-0-lite-260215'
export const ARK_PLATFORM_MODEL_PRESETS = [
  { provider: 'ark', modelId: 'doubao-seedance-2-0-260128', name: 'Doubao Seedance 2.0', type: 'video' },
  { provider: 'ark', modelId: 'doubao-seedance-2-0-fast-260128', name: 'Doubao Seedance 2.0 Fast', type: 'video' },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export const ARK_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-2-0-260128',
    capabilities: {
      video: {
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true],
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutionOptions: ['480p', '720p'],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 8,
        maxReferenceAudios: 3,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-2-0-fast-260128',
    capabilities: {
      video: {
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true],
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutionOptions: ['480p', '720p'],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 8,
        maxReferenceAudios: 3,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-0-pro-fast-251015',
    capabilities: {
      video: {
        generationModeOptions: ['normal'],
        durationOptions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: false,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-0-pro-fast-251015-batch',
    capabilities: {
      video: {
        generationModeOptions: ['normal'],
        durationOptions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: false,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-0-pro-250528',
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: true,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-0-pro-250528-batch',
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: true,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-0-lite-i2v-250428',
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: true,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-0-lite-i2v-250428-batch',
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: true,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-5-pro-251215',
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-5-pro-251215-batch',
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'llm',
    provider: 'ark',
    modelId: 'doubao-seed-1-8-251228',
    capabilities: { llm: { protocol: 'openai-responses', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } },
  },
  {
    modelType: 'llm',
    provider: 'ark',
    modelId: 'doubao-seed-2-0-pro-260215',
    capabilities: { llm: { protocol: 'openai-responses', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } },
  },
  {
    modelType: 'llm',
    provider: 'ark',
    modelId: 'doubao-seed-2-0-lite-260215',
    capabilities: { llm: { protocol: 'openai-responses', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } },
  },
  {
    modelType: 'llm',
    provider: 'ark',
    modelId: 'doubao-seed-2-0-mini-260215',
    capabilities: { llm: { protocol: 'openai-responses', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'] } },
  },
  {
    modelType: 'llm',
    provider: 'ark',
    modelId: 'doubao-seed-1-6-251015',
    capabilities: { llm: { protocol: 'openai-responses' } },
  },
  {
    modelType: 'llm',
    provider: 'ark',
    modelId: 'doubao-seed-1-6-lite-251015',
    capabilities: { llm: { protocol: 'openai-responses' } },
  },
] as const

export const ARK_API_CONFIG_CATALOG_MODELS = [
  { modelId: 'doubao-seed-1-8-251228', name: 'Doubao Seed 1.8', type: 'llm', provider: 'ark' },
  { modelId: 'doubao-seed-2-0-pro-260215', name: 'Doubao Seed 2.0 Pro', type: 'llm', provider: 'ark' },
  { modelId: 'doubao-seed-2-0-lite-260215', name: 'Doubao Seed 2.0 Lite', type: 'llm', provider: 'ark' },
  { modelId: 'doubao-seed-2-0-mini-260215', name: 'Doubao Seed 2.0 Mini', type: 'llm', provider: 'ark' },
  { modelId: 'doubao-seed-1-6-251015', name: 'Doubao Seed 1.6', type: 'llm', provider: 'ark' },
  { modelId: 'doubao-seed-1-6-lite-251015', name: 'Doubao Seed 1.6 Lite', type: 'llm', provider: 'ark' },
  { modelId: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5', type: 'image', provider: 'ark' },
  { modelId: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0', type: 'image', provider: 'ark' },
  { modelId: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0 Lite', type: 'image', provider: 'ark' },
  { modelId: 'doubao-seedance-1-0-pro-fast-251015', name: 'Seedance 1.0 Pro Fast', type: 'video', provider: 'ark' },
  { modelId: 'doubao-seedance-1-0-lite-i2v-250428', name: 'Seedance 1.0 Lite', type: 'video', provider: 'ark' },
  { modelId: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro', type: 'video', provider: 'ark' },
  { modelId: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', type: 'video', provider: 'ark' },
  { modelId: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', type: 'video', provider: 'ark' },
  { modelId: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro', type: 'video', provider: 'ark' },
] as const

export const ARK_VIDEO_SPECS: Record<string, { durationMin: number; durationMax: number; resolutions: readonly string[] }> = {
  'doubao-seedance-1-0-pro-fast-251015': { durationMin: 2, durationMax: 12, resolutions: ['480p', '720p', '1080p'] },
  'doubao-seedance-1-0-pro-250528': { durationMin: 2, durationMax: 12, resolutions: ['480p', '720p', '1080p'] },
  'doubao-seedance-1-0-lite-i2v-250428': { durationMin: 2, durationMax: 12, resolutions: ['480p', '720p', '1080p'] },
  'doubao-seedance-1-5-pro-251215': { durationMin: 4, durationMax: 12, resolutions: ['480p', '720p', '1080p'] },
  'doubao-seedance-2-0-260128': { durationMin: 4, durationMax: 15, resolutions: ['480p', '720p'] },
  'doubao-seedance-2-0-fast-260128': { durationMin: 4, durationMax: 15, resolutions: ['480p', '720p'] },
}

function arkFlatPricing(flatAmount: number) {
  return { mode: 'flat' as const, flatAmount }
}

function arkCapabilityPricing(
  tiers: ReadonlyArray<{ when: Record<string, string | number | boolean>; amount: number }>,
  unit?: 'per_call' | 'per_second',
) {
  return { mode: 'capability' as const, ...(unit ? { unit } : {}), tiers }
}

function arkTokenPricing(input: number, output: number) {
  return arkCapabilityPricing([
    { when: { tokenType: 'input' }, amount: input },
    { when: { tokenType: 'output' }, amount: output },
  ])
}

/**
 * Ark bills Seedance 2.0 per million tokens, and a video's token count is a
 * fixed function of its pixel count: `width * height * fps / 1024` per second.
 * At 16:9 that is 21,600 tokens/s for 720p and 10,046.25 tokens/s for 480p
 * (fps 24), so the published ¥46/M (standard) and ¥37/M (fast) rates reduce to
 * the per-second costs below. Other aspect ratios differ by under 1%, which
 * only moves margin reporting — users are charged the retail per-second rate.
 *
 * Video-to-video carries a separate token rate whose cost depends on the input
 * clip's length, which a per-output-second rate cannot express. No product path
 * quotes video input today, so no tier is declared for it: an attempt to price
 * one fails closed rather than resolving to a wrong rate.
 */
const SEEDANCE_2_COST_PER_SECOND_CNY = {
  standard: { '480p': 0.4621, '720p': 0.9936 },
  fast: { '480p': 0.3717, '720p': 0.7992 },
} as const

function arkResolutionPricing(tiers: ReadonlyArray<readonly [resolution: string, amount: number]>) {
  return arkCapabilityPricing(tiers.map(([resolution, amount]) => ({
    when: { resolution },
    amount,
  })), 'per_second')
}

function arkResolutionAudioPricing(
  tiers: ReadonlyArray<readonly [resolution: string, generateAudio: boolean, amount: number]>,
) {
  return arkCapabilityPricing(tiers.map(([resolution, generateAudio, amount]) => ({
    when: { resolution, generateAudio },
    amount,
  })), 'per_second')
}

export const ARK_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'text', provider: 'ark', modelId: 'doubao-seed-1-8-251228', cost: arkTokenPricing(0.8, 2) },
  { apiType: 'text', provider: 'ark', modelId: 'doubao-seed-2-0-pro-260215', cost: arkTokenPricing(3.2, 16) },
  { apiType: 'text', provider: 'ark', modelId: 'doubao-seed-2-0-lite-260215', cost: arkTokenPricing(0.6, 3.6) },
  { apiType: 'text', provider: 'ark', modelId: 'doubao-seed-2-0-mini-260215', cost: arkTokenPricing(0.2, 2) },
  { apiType: 'text', provider: 'ark', modelId: 'doubao-seed-1-6-251015', cost: arkTokenPricing(0.8, 2) },
  { apiType: 'text', provider: 'ark', modelId: 'doubao-seed-1-6-lite-251015', cost: arkTokenPricing(0.3, 0.6) },
  // Seedream 5.0 lists at US$0.045 per image up to 2.36MP; converted at the
  // catalog's USD rate. Verify against the Ark console before launch.
  { apiType: 'image', provider: 'ark', modelId: 'doubao-seedream-5-0-260128', cost: arkFlatPricing(0.324), retail: arkFlatPricing(7) },
  { apiType: 'image', provider: 'ark', modelId: 'doubao-seedream-4-5-251128', cost: arkFlatPricing(0.25), retail: arkFlatPricing(5) },
  { apiType: 'image', provider: 'ark', modelId: 'doubao-seedream-4-0-250828', cost: arkFlatPricing(0.2), retail: arkFlatPricing(4) },
  {
    apiType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-2-0-260128',
    cost: arkResolutionPricing([
      ['480p', SEEDANCE_2_COST_PER_SECOND_CNY.standard['480p']],
      ['720p', SEEDANCE_2_COST_PER_SECOND_CNY.standard['720p']],
    ]),
    retail: arkResolutionPricing([['480p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.standard['480p']], ['720p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.standard['720p']]]),
  },
  {
    apiType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-2-0-fast-260128',
    cost: arkResolutionPricing([
      ['480p', SEEDANCE_2_COST_PER_SECOND_CNY.fast['480p']],
      ['720p', SEEDANCE_2_COST_PER_SECOND_CNY.fast['720p']],
    ]),
    retail: arkResolutionPricing([['480p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.fast['480p']], ['720p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.fast['720p']]]),
  },
  { apiType: 'video', provider: 'ark', modelId: 'doubao-seedance-1-0-pro-fast-251015', cost: arkResolutionPricing([['480p', 0.2], ['720p', 0.43], ['1080p', 1.03]]) },
  { apiType: 'video', provider: 'ark', modelId: 'doubao-seedance-1-0-pro-fast-251015-batch', cost: arkResolutionPricing([['480p', 0.1], ['720p', 0.22], ['1080p', 0.51]]) },
  {
    apiType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-5-pro-251215',
    cost: arkResolutionAudioPricing([
      ['480p', true, 0.8],
      ['720p', true, 1.73],
      ['1080p', true, 3.89],
      ['480p', false, 0.4],
      ['720p', false, 0.86],
      ['1080p', false, 1.94],
    ]),
  },
  {
    apiType: 'video',
    provider: 'ark',
    modelId: 'doubao-seedance-1-5-pro-251215-batch',
    cost: arkResolutionAudioPricing([
      ['480p', true, 0.4],
      ['720p', true, 0.86],
      ['1080p', true, 1.94],
      ['480p', false, 0.2],
      ['720p', false, 0.43],
      ['1080p', false, 0.97],
    ]),
  },
  { apiType: 'video', provider: 'ark', modelId: 'doubao-seedance-1-0-pro-250528', cost: arkResolutionPricing([['480p', 0.73], ['720p', 1.54], ['1080p', 3.67]]) },
  { apiType: 'video', provider: 'ark', modelId: 'doubao-seedance-1-0-pro-250528-batch', cost: arkResolutionPricing([['480p', 0.36], ['720p', 0.77], ['1080p', 1.84]]) },
  { apiType: 'video', provider: 'ark', modelId: 'doubao-seedance-1-0-lite-i2v-250428', cost: arkResolutionPricing([['480p', 0.49], ['720p', 1.03], ['1080p', 2.45]]) },
  { apiType: 'video', provider: 'ark', modelId: 'doubao-seedance-1-0-lite-i2v-250428-batch', cost: arkResolutionPricing([['480p', 0.24], ['720p', 0.51], ['1080p', 1.22]]) },
] as const

export const ARK_IMAGE_OPTION_SCHEMA_CONFIG = {
  requiresOneOf: [{ keys: ['aspectRatio', 'size'], message: 'aspectRatio_or_size' }],
  validators: {
    aspectRatio: { kind: 'enum', values: ARK_IMAGE_RATIOS },
    resolution: { kind: 'enum', values: ARK_IMAGE_RESOLUTIONS },
    size: { kind: 'nonEmptyString' },
  },
} satisfies MediaOptionSchemaConfig

export const ARK_VIDEO_OPTION_SCHEMA_CONFIG = {
  validators: {
    aspectRatio: { kind: 'enum', values: ARK_VIDEO_RATIOS },
    generateAudio: { kind: 'boolean' },
    returnLastFrame: { kind: 'boolean' },
    draft: { kind: 'boolean' },
    cameraFixed: { kind: 'boolean' },
    watermark: { kind: 'boolean' },
    seed: { kind: 'integer', min: 0 },
    serviceTier: { kind: 'enum', values: ARK_VIDEO_SERVICE_TIERS },
    executionExpiresAfter: { kind: 'integer', min: 1 },
  },
} satisfies MediaOptionSchemaConfig

export function resolveArkOptionSchema(modality: MediaModality, modelId: string): AiOptionSchema {
  if (modality === 'image') {
    return buildMediaOptionSchema('image', {
      ...ARK_IMAGE_OPTION_SCHEMA_CONFIG,
      validators: {
        aspectRatio: enumValidator(ARK_IMAGE_RATIOS),
        resolution: enumValidator(ARK_IMAGE_RESOLUTIONS),
        size: nonEmptyStringValidator(),
      },
    })
  }
  if (modality === 'video') {
    const spec = ARK_VIDEO_SPECS[modelId]
    return buildMediaOptionSchema('video', {
      ...ARK_VIDEO_OPTION_SCHEMA_CONFIG,
      allowedKeys: modelId === 'doubao-seedance-2-0-260128' || modelId === 'doubao-seedance-2-0-fast-260128'
        ? ['referenceImages', 'referenceAudios']
        : ['referenceImages'],
      validators: {
        aspectRatio: enumValidator(ARK_VIDEO_RATIOS),
        resolution: enumValidator(spec?.resolutions || ['480p', '720p', '1080p']),
        duration: integerRangeValidator({ min: spec?.durationMin, max: spec?.durationMax }),
        generateAudio: (value) => value === undefined || typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'expected_boolean' },
        returnLastFrame: (value) => value === undefined || typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'expected_boolean' },
        draft: (value) => value === undefined || typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'expected_boolean' },
        cameraFixed: (value) => value === undefined || typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'expected_boolean' },
        watermark: (value) => value === undefined || typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'expected_boolean' },
        seed: integerRangeValidator({ min: 0 }),
        serviceTier: enumValidator(ARK_VIDEO_SERVICE_TIERS),
        executionExpiresAfter: integerRangeValidator({ min: 1 }),
        referenceAudios: stringArrayValidator(),
      },
    })
  }
  throw new Error(`ARK_OPTION_SCHEMA_UNSUPPORTED_MODALITY:${modality}`)
}
