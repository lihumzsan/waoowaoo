import type { CapabilityValue } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import { MUSIC_KEY_SCALE_VALUES, MUSIC_TIME_SIGNATURE_VALUES } from '@/lib/workspace-resource/music-parameter-contract'

import type { ComfyUiRuntimeTargetId } from './config'
import {
  H3_MAX_REFERENCE_AUDIOS,
  H3_MAX_REFERENCE_IMAGES,
  resolveH3Dimensions,
} from './profiles'
import {
  H3_ASPECT_RATIOS,
  resolveH3ReferenceDimensions,
  type H3AspectRatio,
} from '@/lib/video-generation/h3-reference-runtime-plan'
import {
  H3_CONTINUATION_MIN_SOURCE_DURATION_MS,
} from '@/lib/video-generation/h3-timeline'
import {
  H3_CONTINUATION_MAX_SOURCE_DURATION_MS,
  H3_DURATION_OPTIONS_SECONDS,
} from '@/lib/video-generation/h3-duration'
import {
  ACE_STEP_1_5_PROFILE,
  COMFYUI_MUSIC_PROFILES,
  MINIMAX_MUSIC_3_PROFILE,
} from './music-profiles'

export const COMFYUI_H3_MODEL_ID = 'minimax-h3-dual-stage-2mp'
export const COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY = `comfyui::${COMFYUI_H3_MODEL_ID}`
export const COMFYUI_H3_DEFAULT_GENERATION_OPTIONS = {
  generateAudio: true,
} as const satisfies Record<string, CapabilityValue>
export const COMFYUI_ACE_STEP_1_5_MODEL_ID = ACE_STEP_1_5_PROFILE.modelId
export const COMFYUI_ACE_STEP_1_5_MODEL_KEY = ACE_STEP_1_5_PROFILE.modelKey
export const COMFYUI_PLATFORM_DEFAULT_MUSIC_MODEL_KEY = MINIMAX_MUSIC_3_PROFILE.modelKey
export const COMFYUI_ACE_STEP_DEFAULT_GENERATION_OPTIONS = ACE_STEP_1_5_PROFILE.defaultGenerationOptions
export const COMFYUI_ACE_STEP_KEY_SCALE_OPTIONS = MUSIC_KEY_SCALE_VALUES
export const COMFYUI_ACE_STEP_TIME_SIGNATURE_OPTIONS = MUSIC_TIME_SIGNATURE_VALUES
export const COMFYUI_MUSIC_DEFAULT_GENERATION_OPTIONS_BY_MODEL_KEY: Readonly<
  Record<string, Readonly<Record<string, CapabilityValue>>>
> = Object.freeze(Object.fromEntries(
  COMFYUI_MUSIC_PROFILES.map((profile) => [profile.modelKey, profile.defaultGenerationOptions]),
))
export const COMFYUI_REGISTERED_MODEL_KEYS = [
  COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
  ...COMFYUI_MUSIC_PROFILES.map((profile) => profile.modelKey),
] as const

const COMFYUI_RUNTIME_TARGET_BY_MODEL_KEY: Readonly<Record<string, ComfyUiRuntimeTargetId>> = Object.freeze({
  [COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY]: 'h3-dual-stage-2mp',
  ...Object.fromEntries(COMFYUI_MUSIC_PROFILES.map((profile) => [profile.modelKey, profile.runtimeTargetId])),
})

function resolveH3ContinuationSourceAspectRatios(
  aspectRatio: H3AspectRatio,
): readonly { readonly width: number; readonly height: number }[] {
  const frameMode = resolveH3Dimensions({ megapixels: 2, aspectRatio })
  const referenceMode = resolveH3ReferenceDimensions({ megapixels: 2, aspectRatio })
  return frameMode.width === referenceMode.width && frameMode.height === referenceMode.height
    ? [frameMode]
    : [frameMode, referenceMode]
}

const H3_CONTINUATION_SOURCE_ASPECT_RATIOS_BY_TARGET = {
  '21:9': resolveH3ContinuationSourceAspectRatios('21:9'),
  '16:9': resolveH3ContinuationSourceAspectRatios('16:9'),
  '4:3': resolveH3ContinuationSourceAspectRatios('4:3'),
  '1:1': resolveH3ContinuationSourceAspectRatios('1:1'),
  '3:4': resolveH3ContinuationSourceAspectRatios('3:4'),
  '9:16': resolveH3ContinuationSourceAspectRatios('9:16'),
  '9:21': resolveH3ContinuationSourceAspectRatios('9:21'),
} satisfies Record<H3AspectRatio, readonly { readonly width: number; readonly height: number }[]>

export function resolveComfyUiRuntimeTargetIdForModelKey(modelKey: string): ComfyUiRuntimeTargetId {
  const targetId = COMFYUI_RUNTIME_TARGET_BY_MODEL_KEY[modelKey]
  if (!targetId) throw new Error(`COMFYUI_MODEL_RUNTIME_TARGET_MISSING:${modelKey}`)
  return targetId
}

export const COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'video', provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID,
    capabilities: {
      video: {
        promptProfile: 'minimax_h3_multimodal_v3',
        supportedInputModes: ['reference', 'first_frame', 'first_last_frame', 'continuation'], supportsTextToVideo: false,
        supportedAspectRatios: [...H3_ASPECT_RATIOS],
        inputModePolicies: {
          reference: { durationOptions: [...H3_DURATION_OPTIONS_SECONDS] },
          first_frame: { durationOptions: [...H3_DURATION_OPTIONS_SECONDS] },
          first_last_frame: { durationOptions: [...H3_DURATION_OPTIONS_SECONDS] },
          continuation: { durationOptions: [...H3_DURATION_OPTIONS_SECONDS] },
        },
        generateAudioOptions: [true], supportGenerateAudio: true,
        assetReferenceMultiReference: true, firstlastframe: true,
        maxReferenceImages: H3_MAX_REFERENCE_IMAGES,
        maxReferenceAudios: H3_MAX_REFERENCE_AUDIOS,
        maxReferenceVideos: 0,
        maxReferenceFiles: H3_MAX_REFERENCE_IMAGES + H3_MAX_REFERENCE_AUDIOS,
        referenceAudioRequiresVisual: true,
        minReferenceAudioDurationMs: 2_000,
        maxTotalReferenceAudioDurationMs: 15_000,
        continuationInput: {
          minSourceDurationMs: H3_CONTINUATION_MIN_SOURCE_DURATION_MS,
          maxSourceDurationMs: H3_CONTINUATION_MAX_SOURCE_DURATION_MS,
          sourceAspectRatiosByTarget: H3_CONTINUATION_SOURCE_ASPECT_RATIOS_BY_TARGET,
        },
      },
    },
  },
  ...COMFYUI_MUSIC_PROFILES.map((profile) => ({
    modelType: 'music' as const,
    provider: 'comfyui' as const,
    modelId: profile.modelId,
    capabilities: { music: profile.capabilities },
  })),
] as const

export const COMFYUI_API_CONFIG_CATALOG_MODELS = [
  { modelId: COMFYUI_H3_MODEL_ID, name: 'MiniMax H3 Dual-Stage 2MP', type: 'video', provider: 'comfyui' },
  ...COMFYUI_MUSIC_PROFILES.map((profile) => ({
    modelId: profile.modelId,
    name: profile.name,
    type: 'music' as const,
    provider: 'comfyui' as const,
  })),
] as const

export const COMFYUI_PLATFORM_MODEL_PRESETS: readonly PlatformModelPreset[] = [
  { provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID, name: 'MiniMax H3 Dual-Stage 2MP', type: 'video' },
  ...COMFYUI_MUSIC_PROFILES.map((profile) => ({
    provider: 'comfyui',
    modelId: profile.modelId,
    name: profile.name,
    type: 'music' as const,
  })),
]
