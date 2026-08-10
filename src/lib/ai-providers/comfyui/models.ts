import type { PlatformModelPreset } from '@/lib/platform-models/types'

export const COMFYUI_H3_MODEL_ID = 'minimax-h3-fast'
export const COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY = `comfyui::${COMFYUI_H3_MODEL_ID}`

const ZERO_PRICE = { mode: 'flat' as const, unit: 'per_call' as const, flatAmount: 0 }

export const COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'video', provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['first_frame', 'first_last_frame'], supportsTextToVideo: false,
        durationOptions: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutionOptions: ['480p', '720p'],
        firstlastframe: true, generateAudioOptions: [true], supportGenerateAudio: true,
        assetReferenceMultiReference: false,
      },
    },
  },
] as const

export const COMFYUI_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'video', provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID, cost: ZERO_PRICE, retail: ZERO_PRICE },
] as const

export const COMFYUI_API_CONFIG_CATALOG_MODELS = [
  { modelId: COMFYUI_H3_MODEL_ID, name: 'MiniMax H3 Fast', type: 'video', provider: 'comfyui' },
] as const

export const COMFYUI_PLATFORM_MODEL_PRESETS: readonly PlatformModelPreset[] = [
  { provider: 'comfyui', modelId: COMFYUI_H3_MODEL_ID, name: 'MiniMax H3 Fast', type: 'video' },
]
