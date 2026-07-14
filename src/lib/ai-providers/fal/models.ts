import type { MediaOptionSchemaConfig } from '@/lib/ai-providers/shared/media-option-schema-config'
import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  buildMediaOptionSchema,
  createFalVideoObjectValidator,
  enumValidator,
  integerRangeValidator,
  nonEmptyStringValidator,
  numberRangeValidator,
  type MediaModality,
} from '@/lib/ai-providers/shared/option-schema'
import {
  OPENAI_IMAGE_OUTPUT_FORMATS,
  OPENAI_OFFICIAL_IMAGE_QUALITIES,
} from '@/lib/ai-providers/shared/openai-image'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'

export const FAL_GPT_IMAGE_2_MODEL_ID = 'gpt-image-2'
export const FAL_LYRIA_3_PRO_MODEL_ID = 'fal-ai/lyria3/pro'
export const FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY = `fal::${FAL_GPT_IMAGE_2_MODEL_ID}`
export const FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY = `fal::${FAL_LYRIA_3_PRO_MODEL_ID}`
export const FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID = 'alibaba/happy-horse/image-to-video'
export const FAL_SEEDANCE_2_VIDEO_MODEL_ID = 'bytedance/seedance-2.0'
export const FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID = 'bytedance/seedance-2.0/fast'
export const FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID = 'fal-ai/kling-video/o3/standard/image-to-video'
export const FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID = 'fal-ai/kling-video/o3/pro/image-to-video'
export const FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID = 'fal-ai/kling-video/v3/standard/image-to-video'
export const FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID = 'fal-ai/kling-video/v3/pro/image-to-video'
export const FAL_IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const
export const FAL_GPT_IMAGE_2_QUALITY_OPTIONS = ['high', 'medium', 'low'] as const

export const FAL_PLATFORM_MODEL_PRESETS = [
  { provider: 'fal', modelId: 'banana-2', name: 'Banana 2', type: 'image' },
  { provider: 'fal', modelId: FAL_GPT_IMAGE_2_MODEL_ID, name: 'GPT Image 2', type: 'image' },
  { provider: 'fal', modelId: FAL_LYRIA_3_PRO_MODEL_ID, name: 'Lyria 3 Pro', type: 'music' },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export const FAL_VIDEO_MODEL_IDS = new Set([
  'fal-wan25',
  'fal-veo31',
  FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
])

export const FAL_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'image',
    provider: 'fal',
    modelId: 'banana-2',
    capabilities: { image: { resolutionOptions: ['1K', '2K', '4K'] } },
  },
  {
    modelType: 'image',
    provider: 'fal',
    modelId: FAL_GPT_IMAGE_2_MODEL_ID,
    capabilities: { image: { resolutionOptions: [...FAL_IMAGE_RESOLUTIONS], qualityOptions: [...FAL_GPT_IMAGE_2_QUALITY_OPTIONS] } },
  },
  {
    modelType: 'music',
    provider: 'fal',
    modelId: FAL_LYRIA_3_PRO_MODEL_ID,
    capabilities: {
      music: {
        durationSecondsRange: { min: 120, max: 180 },
        vocalModeOptions: ['instrumental', 'vocal'],
        outputFormatOptions: ['mp3'],
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        generationModeOptions: ['normal'],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutionOptions: ['720p', '1080p'],
        firstlastframe: false,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_SEEDANCE_2_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true],
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 8,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true],
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutionOptions: ['480p', '720p'],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 8,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    capabilities: { video: { generationModeOptions: ['normal'], durationOptions: [5, 10], firstlastframe: false, supportGenerateAudio: false } },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        generationModeOptions: ['normal'],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        firstlastframe: false,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        generationModeOptions: ['normal'],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        firstlastframe: false,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
] as const

export const FAL_API_CONFIG_CATALOG_MODELS = [
  { modelId: 'banana', name: 'Banana Pro', type: 'image', provider: 'fal' },
  { modelId: 'banana-2', name: 'Banana 2', type: 'image', provider: 'fal' },
  { modelId: FAL_GPT_IMAGE_2_MODEL_ID, name: 'GPT Image 2', type: 'image', provider: 'fal' },
  { modelId: FAL_LYRIA_3_PRO_MODEL_ID, name: 'Lyria 3 Pro', type: 'music', provider: 'fal' },
  { modelId: 'fal-wan25', name: 'Wan 2.6', type: 'video', provider: 'fal' },
  { modelId: 'fal-veo31', name: 'Veo 3.1', type: 'video', provider: 'fal' },
  { modelId: 'fal-sora2', name: 'Sora 2', type: 'video', provider: 'fal' },
  { modelId: FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID, name: 'Happy Horse 1.0', type: 'video', provider: 'fal' },
  { modelId: FAL_SEEDANCE_2_VIDEO_MODEL_ID, name: 'Seedance 2.0', type: 'video', provider: 'fal' },
  { modelId: FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID, name: 'Seedance 2.0 Fast', type: 'video', provider: 'fal' },
  { modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', name: 'Kling 2.5 Turbo Pro', type: 'video', provider: 'fal' },
  { modelId: FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID, name: 'Kling O3 Standard', type: 'video', provider: 'fal' },
  { modelId: FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID, name: 'Kling O3 Pro', type: 'video', provider: 'fal' },
  { modelId: FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID, name: 'Kling 3 Standard', type: 'video', provider: 'fal' },
  { modelId: FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID, name: 'Kling 3 Pro', type: 'video', provider: 'fal' },
] as const

function falFlatPricing(flatAmount: number) {
  return { mode: 'flat' as const, flatAmount }
}

function falGptImage2Pricing() {
  const rows = [
    ['1024x768', { low: 0.005, medium: 0.037, high: 0.145 }],
    ['1024x1024', { low: 0.006, medium: 0.053, high: 0.211 }],
    ['1024x1536', { low: 0.005, medium: 0.042, high: 0.165 }],
    ['1920x1080', { low: 0.005, medium: 0.040, high: 0.158 }],
    ['2560x1440', { low: 0.007, medium: 0.056, high: 0.222 }],
    ['3840x2160', { low: 0.012, medium: 0.101, high: 0.401 }],
  ] as const
  return {
    mode: 'capability' as const,
    tiers: rows.flatMap(([imageSize, prices]) => [
      { when: { imageSize, quality: 'low' }, amount: usdToCredits(prices.low) },
      { when: { imageSize, quality: 'medium' }, amount: usdToCredits(prices.medium) },
      { when: { imageSize, quality: 'high' }, amount: usdToCredits(prices.high) },
    ]),
  }
}

function falDurationPricing(tiers: ReadonlyArray<readonly [duration: number, amount: number]>) {
  return {
    mode: 'capability' as const,
    unit: 'per_call' as const,
    tiers: tiers.map(([duration, amount]) => ({ when: { duration }, amount })),
  }
}

function falDurationRatePricing(input: { durations: readonly number[]; amountPerSecond: number }) {
  return falDurationPricing(input.durations.map((duration) => [duration, Number((duration * input.amountPerSecond).toFixed(4))] as const))
}

const FAL_KLING_EXTENDED_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

export const FAL_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'image', provider: 'fal', modelId: 'banana', pricing: falFlatPricing(0.9648) },
  {
    apiType: 'image',
    provider: 'fal',
    modelId: 'banana-2',
    pricing: {
      mode: 'capability',
      tiers: [
        { when: { resolution: '1K' }, amount: 0.576 },
        { when: { resolution: '2K' }, amount: 0.864 },
        { when: { resolution: '4K' }, amount: 1.152 },
      ],
    },
  },
  { apiType: 'image', provider: 'fal', modelId: FAL_GPT_IMAGE_2_MODEL_ID, pricing: falGptImage2Pricing() },
  { apiType: 'music', provider: 'fal', modelId: FAL_LYRIA_3_PRO_MODEL_ID, pricing: falFlatPricing(usdToCredits(0.08)) },
  { apiType: 'video', provider: 'fal', modelId: 'fal-wan25', pricing: falFlatPricing(1.8) },
  { apiType: 'video', provider: 'fal', modelId: 'fal-veo31', pricing: falFlatPricing(2.88) },
  { apiType: 'video', provider: 'fal', modelId: 'fal-kling25', pricing: falFlatPricing(2.16) },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
    pricing: {
      mode: 'capability',
      unit: 'per_second',
      tiers: [
        { when: { resolution: '720p' }, amount: 0.7 },
        { when: { resolution: '1080p' }, amount: 1.4 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_SEEDANCE_2_VIDEO_MODEL_ID,
    pricing: {
      mode: 'capability',
      unit: 'per_second',
      tiers: [
        { when: { resolution: '480p' }, amount: 0.1346 },
        { when: { resolution: '720p' }, amount: 0.3024 },
        { when: { resolution: '1080p' }, amount: 0.6804 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
    pricing: {
      mode: 'capability',
      unit: 'per_second',
      tiers: [
        { when: { resolution: '480p' }, amount: 0.1077 },
        { when: { resolution: '720p' }, amount: 0.2419 },
      ],
    },
  },
  { apiType: 'video', provider: 'fal', modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', pricing: falDurationPricing([[5, 0.35], [10, 0.7]]) },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
    pricing: falDurationRatePricing({ durations: FAL_KLING_EXTENDED_DURATIONS, amountPerSecond: 0.224 }),
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
    pricing: falDurationRatePricing({ durations: FAL_KLING_EXTENDED_DURATIONS, amountPerSecond: 0.35 }),
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
    pricing: falDurationPricing([[3, 0.504], [4, 0.672], [5, 0.84], [6, 1.008], [7, 1.176], [8, 1.344], [9, 1.512], [10, 1.68], [11, 1.848], [12, 2.016], [13, 2.184], [14, 2.352], [15, 2.52]]),
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
    pricing: falDurationPricing([[3, 0.672], [4, 0.896], [5, 1.12], [6, 1.344], [7, 1.568], [8, 1.792], [9, 2.016], [10, 2.24], [11, 2.464], [12, 2.688], [13, 2.912], [14, 3.136], [15, 3.36]]),
  },
] as const

export const FAL_IMAGE_OPTION_SCHEMA_CONFIG = {
  validators: {
    resolution: { kind: 'enum', values: FAL_IMAGE_RESOLUTIONS },
  },
} satisfies MediaOptionSchemaConfig

export const FAL_VIDEO_OPTION_SCHEMA_CONFIG = {
  objectValidatorKind: 'falVideoModel',
  validators: {
    duration: { kind: 'integer', min: 1 },
    aspectRatio: { kind: 'nonEmptyString' },
    resolution: { kind: 'nonEmptyString' },
  },
} satisfies MediaOptionSchemaConfig

export function resolveFalOptionSchema(modality: MediaModality, modelId: string): AiOptionSchema {
  if (modality === 'image') {
    if (modelId === FAL_GPT_IMAGE_2_MODEL_ID) {
      return buildMediaOptionSchema('image', {
        validators: {
          size: enumValidator(FAL_IMAGE_RESOLUTIONS),
          resolution: enumValidator(FAL_IMAGE_RESOLUTIONS),
          outputFormat: enumValidator(OPENAI_IMAGE_OUTPUT_FORMATS),
          quality: enumValidator(OPENAI_OFFICIAL_IMAGE_QUALITIES),
        },
      })
    }
    return buildMediaOptionSchema('image', {
      ...FAL_IMAGE_OPTION_SCHEMA_CONFIG,
      validators: {
        resolution: enumValidator(FAL_IMAGE_RESOLUTIONS),
        outputFormat: enumValidator(OPENAI_IMAGE_OUTPUT_FORMATS),
      },
    })
  }
  if (modality === 'music') {
    if (modelId === FAL_LYRIA_3_PRO_MODEL_ID) {
      return buildMediaOptionSchema('music', {
        validators: {
          negativePrompt: nonEmptyStringValidator(),
          durationSeconds: numberRangeValidator({ min: 120, max: 180 }),
          vocalMode: enumValidator(['instrumental', 'vocal']),
          genre: nonEmptyStringValidator(),
          mood: nonEmptyStringValidator(),
          bpm: integerRangeValidator({ min: 20, max: 300 }),
          outputFormat: enumValidator(['mp3']),
        },
      })
    }
    return buildMediaOptionSchema('music')
  }
  if (modality === 'video') {
    if (modelId === FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID) {
      return buildMediaOptionSchema('video', {
        ...FAL_VIDEO_OPTION_SCHEMA_CONFIG,
        allowedKeys: ['referenceImages'],
        validators: {
          duration: integerRangeValidator({ min: 3, max: 15 }),
          aspectRatio: enumValidator(['16:9', '9:16', '1:1', '4:3', '3:4']),
          resolution: enumValidator(['720p', '1080p']),
        },
        objectValidators: [createFalVideoObjectValidator(modelId, FAL_VIDEO_MODEL_IDS)],
      })
    }
    if (modelId === FAL_SEEDANCE_2_VIDEO_MODEL_ID || modelId === FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID) {
      return buildMediaOptionSchema('video', {
        ...FAL_VIDEO_OPTION_SCHEMA_CONFIG,
        allowedKeys: ['referenceImages'],
        validators: {
          duration: integerRangeValidator({ min: 4, max: 15 }),
          aspectRatio: enumValidator(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
          resolution: enumValidator(modelId === FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID ? ['480p', '720p'] : ['480p', '720p', '1080p']),
        },
        objectValidators: [createFalVideoObjectValidator(modelId, FAL_VIDEO_MODEL_IDS)],
      })
    }
    if (modelId === 'fal-veo31') {
      return buildMediaOptionSchema('video', {
        ...FAL_VIDEO_OPTION_SCHEMA_CONFIG,
        allowedKeys: ['referenceImages'],
        validators: {
          duration: integerRangeValidator({ min: 1 }),
          aspectRatio: nonEmptyStringValidator(),
          resolution: nonEmptyStringValidator(),
        },
        objectValidators: [createFalVideoObjectValidator(modelId, FAL_VIDEO_MODEL_IDS)],
      })
    }
    if (modelId === FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID || modelId === FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID) {
      return buildMediaOptionSchema('video', {
        ...FAL_VIDEO_OPTION_SCHEMA_CONFIG,
        allowedKeys: ['generationMode', 'referenceImages'],
        validators: {
          duration: integerRangeValidator({ min: 3, max: 15 }),
          aspectRatio: enumValidator(['16:9', '9:16', '1:1']),
          resolution: nonEmptyStringValidator(),
        },
        objectValidators: [createFalVideoObjectValidator(modelId, FAL_VIDEO_MODEL_IDS)],
      })
    }
    if (modelId === FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID || modelId === FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID) {
      return buildMediaOptionSchema('video', {
        ...FAL_VIDEO_OPTION_SCHEMA_CONFIG,
        allowedKeys: ['referenceImages'],
        validators: {
          duration: integerRangeValidator({ min: 3, max: 15 }),
          aspectRatio: enumValidator(['16:9', '9:16', '1:1']),
          resolution: nonEmptyStringValidator(),
        },
        objectValidators: [createFalVideoObjectValidator(modelId, FAL_VIDEO_MODEL_IDS)],
      })
    }
    return buildMediaOptionSchema('video', {
      ...FAL_VIDEO_OPTION_SCHEMA_CONFIG,
      validators: {
        duration: integerRangeValidator({ min: 1 }),
        aspectRatio: nonEmptyStringValidator(),
        resolution: nonEmptyStringValidator(),
      },
      objectValidators: [createFalVideoObjectValidator(modelId, FAL_VIDEO_MODEL_IDS)],
    })
  }
  throw new Error(`FAL_MODALITY_UNSUPPORTED:${modality}`)
}
