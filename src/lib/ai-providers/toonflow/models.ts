import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  booleanValidator,
  buildMediaOptionSchema,
  enumValidator,
  integerRangeValidator,
  stringArrayValidator,
  type MediaModality,
} from '@/lib/ai-providers/shared/option-schema'
import { SEEDANCE_2_RETAIL_CREDITS_PER_SECOND } from '@/lib/ai-providers/shared/seedance-pricing'

export const TOONFLOW_SEEDANCE_2_MODEL_ID = 'seedance-2.0'
export const TOONFLOW_SEEDANCE_2_WIRE_MODEL = 'Seedance 2.0'
export const TOONFLOW_SEEDANCE_2_FAST_MODEL_ID = 'seedance-2.0-fast'
export const TOONFLOW_SEEDANCE_2_FAST_WIRE_MODEL = 'Seedance 2.0 fast'
export const TOONFLOW_PLATFORM_DEFAULT_VIDEO_MODEL_KEY = `toonflow::${TOONFLOW_SEEDANCE_2_MODEL_ID}`

export const TOONFLOW_SEEDANCE_2_DURATION_OPTIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const
export const TOONFLOW_SEEDANCE_2_RESOLUTION_OPTIONS = ['480p', '720p', '1080p'] as const
export const TOONFLOW_SEEDANCE_2_FAST_RESOLUTION_OPTIONS = ['480p', '720p'] as const
export const TOONFLOW_SEEDANCE_2_ASPECT_RATIO_OPTIONS = [
  '1:1', '3:4', '9:16', '4:3', '16:9', '21:9', '9:21',
] as const

function toonflowVideoPricing(
  tiers: ReadonlyArray<readonly [resolution: string, amount: number]>,
) {
  return {
    mode: 'capability' as const,
    unit: 'per_second' as const,
    tiers: tiers.map(([resolution, amount]) => ({
      when: { resolution },
      amount,
    })),
  }
}

export const TOONFLOW_BUILTIN_PRICING_CATALOG_ENTRIES = [
  {
    apiType: 'video',
    provider: 'toonflow',
    modelId: TOONFLOW_SEEDANCE_2_MODEL_ID,
    // Toonflow publishes a range by resolution. Until the provider returns
    // settled usage, the upper bound is the only safe cost for margin reports.
    // Video-reference pricing is intentionally absent: Wao does not expose a
    // video-to-video generation input today.
    cost: toonflowVideoPricing([
      ['480p', 0.5],
      ['720p', 1],
      ['1080p', 2.5],
    ]),
    retail: toonflowVideoPricing([
      ['480p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.standard['480p']],
      ['720p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.standard['720p']],
      ['1080p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.standard['1080p']],
    ]),
  },
  {
    apiType: 'video',
    provider: 'toonflow',
    modelId: TOONFLOW_SEEDANCE_2_FAST_MODEL_ID,
    cost: toonflowVideoPricing([
      ['480p', 0.4],
      ['720p', 0.83],
    ]),
    retail: toonflowVideoPricing([
      ['480p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.fast['480p']],
      ['720p', SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.fast['720p']],
    ]),
  },
] as const

export const TOONFLOW_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'video',
    provider: 'toonflow',
    modelId: TOONFLOW_SEEDANCE_2_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [...TOONFLOW_SEEDANCE_2_DURATION_OPTIONS],
        resolutionOptions: [...TOONFLOW_SEEDANCE_2_RESOLUTION_OPTIONS],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 9,
        maxReferenceAudios: 3,
        maxReferenceVideos: 3,
        maxReferenceFiles: 12,
        referenceAudioRequiresVisual: true,
        minReferenceAudioDurationMs: 1_800,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'toonflow',
    modelId: TOONFLOW_SEEDANCE_2_FAST_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [...TOONFLOW_SEEDANCE_2_DURATION_OPTIONS],
        resolutionOptions: [...TOONFLOW_SEEDANCE_2_FAST_RESOLUTION_OPTIONS],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 9,
        maxReferenceAudios: 3,
        maxReferenceVideos: 3,
        maxReferenceFiles: 12,
        referenceAudioRequiresVisual: true,
        minReferenceAudioDurationMs: 1_800,
      },
    },
  },
] as const

export const TOONFLOW_API_CONFIG_CATALOG_MODELS = [
  {
    modelId: TOONFLOW_SEEDANCE_2_MODEL_ID,
    name: 'Seedance 2.0',
    type: 'video',
    provider: 'toonflow',
  },
  {
    modelId: TOONFLOW_SEEDANCE_2_FAST_MODEL_ID,
    name: 'Seedance 2.0 Fast',
    type: 'video',
    provider: 'toonflow',
  },
] as const

export const TOONFLOW_PLATFORM_MODEL_PRESETS = [
  {
    provider: 'toonflow',
    modelId: TOONFLOW_SEEDANCE_2_MODEL_ID,
    name: 'Seedance 2.0',
    type: 'video',
  },
  {
    provider: 'toonflow',
    modelId: TOONFLOW_SEEDANCE_2_FAST_MODEL_ID,
    name: 'Seedance 2.0 Fast',
    type: 'video',
  },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export function resolveToonflowOptionSchema(
  modality: MediaModality,
  modelId: string,
): AiOptionSchema {
  if (
    modality !== 'video'
    || (modelId !== TOONFLOW_SEEDANCE_2_MODEL_ID && modelId !== TOONFLOW_SEEDANCE_2_FAST_MODEL_ID)
  ) {
    throw new Error(`TOONFLOW_MODALITY_UNSUPPORTED:${modality}:${modelId}`)
  }
  return buildMediaOptionSchema('video', {
    allowedKeys: ['referenceImages', 'referenceAudios', 'referenceVideos'],
    excludedKeys: [
      'size',
      'promptExtend',
      'serviceTier',
      'executionExpiresAfter',
      'returnLastFrame',
      'draft',
      'seed',
      'cameraFixed',
      'watermark',
    ],
    required: ['duration', 'resolution', 'aspectRatio', 'generateAudio'],
    validators: {
      duration: integerRangeValidator({ min: 4, max: 15 }),
      resolution: enumValidator(
        modelId === TOONFLOW_SEEDANCE_2_FAST_MODEL_ID
          ? TOONFLOW_SEEDANCE_2_FAST_RESOLUTION_OPTIONS
          : TOONFLOW_SEEDANCE_2_RESOLUTION_OPTIONS,
      ),
      aspectRatio: enumValidator(TOONFLOW_SEEDANCE_2_ASPECT_RATIO_OPTIONS),
      generateAudio: booleanValidator(),
      referenceImages: stringArrayValidator({ maxLength: 9 }),
      referenceAudios: stringArrayValidator({ maxLength: 3 }),
      referenceVideos: stringArrayValidator({ maxLength: 3 }),
    },
    objectValidators: [(options) => {
      const lastFrame = typeof options.lastFrameImageUrl === 'string'
        ? options.lastFrameImageUrl.trim()
        : ''
      if (!lastFrame) return { ok: true }
      if (Array.isArray(options.referenceImages) && options.referenceImages.length > 0) {
        return { ok: false, reason: 'last_frame_conflicts_with_reference_images' }
      }
      if (Array.isArray(options.referenceAudios) && options.referenceAudios.length > 0) {
        return { ok: false, reason: 'last_frame_conflicts_with_reference_audios' }
      }
      return { ok: true }
    }],
  })
}
