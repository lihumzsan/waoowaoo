import type { PlatformModelPreset } from '@/lib/platform-models/types'

export const COMFYUI_H3_MODEL_ID = 'minimax-h3-fast'
export const COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY = `comfyui::${COMFYUI_H3_MODEL_ID}`
export const COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID = 'moss-soundeffect-v2'
export const COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY = `comfyui::${COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID}`
export const COMFYUI_PLATFORM_DEFAULT_SOUND_MODEL_KEY = COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_KEY

const ZERO_PRICE = { mode: 'flat' as const, unit: 'per_call' as const, flatAmount: 0 }

export const COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'video', provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['first_frame', 'first_last_frame'], supportsTextToVideo: false,
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutionOptions: ['480p', '720p'],
        firstlastframe: true, generateAudioOptions: [true], supportGenerateAudio: true,
        assetReferenceMultiReference: false,
      },
    },
  },
  {
    modelType: 'sound', provider: 'comfyui', modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID,
    capabilities: {
      sound: {
        durationSecondsRange: { min: 1, max: 30 },
        outputFormatOptions: ['mp3'],
      },
    },
  },
] as const

export const COMFYUI_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'video', provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID, cost: ZERO_PRICE, retail: ZERO_PRICE },
  { apiType: 'sound', provider: 'comfyui', modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID, cost: ZERO_PRICE, retail: ZERO_PRICE },
] as const

export const COMFYUI_API_CONFIG_CATALOG_MODELS = [
  { modelId: COMFYUI_H3_MODEL_ID, name: 'MiniMax H3 Fast', type: 'video', provider: 'comfyui' },
  { modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID, name: 'MOSS SoundEffect v2', type: 'sound', provider: 'comfyui' },
] as const

export const COMFYUI_PLATFORM_MODEL_PRESETS: readonly PlatformModelPreset[] = [
  { provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID, name: 'MiniMax H3 Fast', type: 'video' },
  { provider: 'comfyui', modelId: COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID, name: 'MOSS SoundEffect v2', type: 'sound' },
]
