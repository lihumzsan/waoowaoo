import type { CapabilityValue } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import { MUSIC_KEY_SCALE_VALUES, MUSIC_TIME_SIGNATURE_VALUES } from '@/lib/workspace-resource/music-parameter-contract'

import type { ComfyUiRuntimeTargetId } from './config'
import { H3_MAX_REFERENCE_IMAGES } from './profiles'

export const COMFYUI_H3_MODEL_ID = 'minimax-h3-dual-stage-2mp'
export const COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY = `comfyui::${COMFYUI_H3_MODEL_ID}`
export const COMFYUI_H3_DEFAULT_GENERATION_OPTIONS = {
  generateAudio: true,
} as const satisfies Record<string, CapabilityValue>
export const COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID = 'moss-soundeffect-v2'
export const COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY = `comfyui::${COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID}`
export const COMFYUI_PLATFORM_DEFAULT_SOUND_MODEL_KEY = COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY
export const COMFYUI_ACE_STEP_1_5_MODEL_ID = 'ace-step-1.5'
export const COMFYUI_ACE_STEP_1_5_MODEL_KEY = `comfyui::${COMFYUI_ACE_STEP_1_5_MODEL_ID}`
export const COMFYUI_PLATFORM_DEFAULT_MUSIC_MODEL_KEY = COMFYUI_ACE_STEP_1_5_MODEL_KEY
export const COMFYUI_ACE_STEP_DEFAULT_GENERATION_OPTIONS = {
  outputFormat: 'mp3',
} as const satisfies Record<string, CapabilityValue>
export const COMFYUI_ACE_STEP_KEY_SCALE_OPTIONS = MUSIC_KEY_SCALE_VALUES
export const COMFYUI_ACE_STEP_TIME_SIGNATURE_OPTIONS = MUSIC_TIME_SIGNATURE_VALUES
export const COMFYUI_MOSS_TTS_LOCAL_MODEL_ID = 'moss-tts-local-1.7b'
export const COMFYUI_MOSS_TTS_LOCAL_MODEL_KEY = `comfyui::${COMFYUI_MOSS_TTS_LOCAL_MODEL_ID}`

export const COMFYUI_REGISTERED_MODEL_KEYS = [
  COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
  COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY,
  COMFYUI_ACE_STEP_1_5_MODEL_KEY,
  COMFYUI_MOSS_TTS_LOCAL_MODEL_KEY,
] as const

const COMFYUI_RUNTIME_TARGET_BY_MODEL_KEY: Record<string, ComfyUiRuntimeTargetId> = {
  [COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY]: 'h3-dual-stage-2mp',
  [COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY]: 'shared',
  [COMFYUI_ACE_STEP_1_5_MODEL_KEY]: 'shared',
  [COMFYUI_MOSS_TTS_LOCAL_MODEL_KEY]: 'shared',
}

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
        promptProfile: 'minimax_h3_reference_v2',
        supportedInputModes: ['reference'], supportsTextToVideo: false,
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        generateAudioOptions: [true], supportGenerateAudio: true,
        assetReferenceMultiReference: true, maxReferenceImages: H3_MAX_REFERENCE_IMAGES, maxReferenceFiles: H3_MAX_REFERENCE_IMAGES,
      },
    },
  },
  {
    modelType: 'sound', provider: 'comfyui', modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID,
    capabilities: { sound: { durationSecondsRange: { min: 1, max: 30 }, outputFormatOptions: ['mp3'] } },
  },
  {
    modelType: 'music', provider: 'comfyui', modelId: COMFYUI_ACE_STEP_1_5_MODEL_ID,
    capabilities: {
      music: {
        generationModes: ['prompt'],
        durationSecondsRange: { min: 4, max: 600 }, vocalModeOptions: ['instrumental'], outputFormatOptions: ['mp3'],
        bpmRange: { min: 20, max: 300 }, keyScaleOptions: COMFYUI_ACE_STEP_KEY_SCALE_OPTIONS,
        timeSignatureOptions: COMFYUI_ACE_STEP_TIME_SIGNATURE_OPTIONS,
      },
    },
  },
  {
    modelType: 'voice', provider: 'comfyui', modelId: COMFYUI_MOSS_TTS_LOCAL_MODEL_ID,
    capabilities: {
      voice: {
        useCases: ['voiceover_clone'], languageOptions: ['auto', 'zh', 'en', 'ja', 'ko'], requiresReferenceAudio: true,
        referenceAudioDurationMsRange: { min: 3000, max: 10000 }, outputFormatOptions: ['mp3'], outputSampleRateHz: 24000,
        textMaxChars: 4096,
      },
    },
  },
] as const

export const COMFYUI_API_CONFIG_CATALOG_MODELS = [
  { modelId: COMFYUI_H3_MODEL_ID, name: 'MiniMax H3 Dual-Stage 2MP', type: 'video', provider: 'comfyui' },
  { modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID, name: 'MOSS SoundEffect v2', type: 'sound', provider: 'comfyui' },
  { modelId: COMFYUI_ACE_STEP_1_5_MODEL_ID, name: 'ACE-Step 1.5', type: 'music', provider: 'comfyui' },
  { modelId: COMFYUI_MOSS_TTS_LOCAL_MODEL_ID, name: 'MOSS TTS Local 1.7B', type: 'voice', provider: 'comfyui' },
] as const

export const COMFYUI_PLATFORM_MODEL_PRESETS: readonly PlatformModelPreset[] = [
  { provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID, name: 'MiniMax H3 Dual-Stage 2MP', type: 'video' },
  { provider: 'comfyui', modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID, name: 'MOSS SoundEffect v2', type: 'sound' },
  { provider: 'comfyui', modelId: COMFYUI_ACE_STEP_1_5_MODEL_ID, name: 'ACE-Step 1.5', type: 'music' },
  { provider: 'comfyui', modelId: COMFYUI_MOSS_TTS_LOCAL_MODEL_ID, name: 'MOSS TTS Local 1.7B', type: 'voice' },
]
