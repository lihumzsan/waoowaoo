import {
  COMFYUI_LTX23_WORKFLOW_KEYS,
} from './ltx23-workflow-profiles'
import {
  COMFYUI_SEEDANCE2_BERNINI_AUDIO_WORKFLOW_ID,
  COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID,
} from './seedance2-bernini-workflow'

const AUDIO_WORKFLOWS = [
  ['baseaudio/environment/stable-audio-3-medium', 'Stable Audio 3 Medium'],
  ['baseaudio/单人/LongCat-one', 'LongCat 单人'],
  ['baseaudio/单人/s2-one', 'S2 单人'],
  ['baseaudio/多人/LongCat-two', 'LongCat 多人'],
  ['baseaudio/多人/s2-two', 'S2 多人'],
  ['baseaudio/三人/s2-three', 'S2 三人'],
  ['baseaudio/音色/s2-se', 'S2 音色'],
] as const

const VIDEO_WORKFLOWS = [
  [COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID, 'Seedance2 Bernini I2V'],
  [COMFYUI_SEEDANCE2_BERNINI_AUDIO_WORKFLOW_ID, 'Seedance2 Bernini Audio LipSync'],
  ...Object.entries(COMFYUI_LTX23_WORKFLOW_KEYS).map(([key, value]) => [value, `LTX2.3 ${key}`] as const),
] as const

export const COMFYUI_API_CONFIG_CATALOG_MODELS = [
  ...VIDEO_WORKFLOWS.map(([modelId, name]) => ({ modelId, name: `ComfyUI · ${name}`, type: 'video' as const, provider: 'comfyui' as const })),
  ...AUDIO_WORKFLOWS.map(([modelId, name]) => ({ modelId, name: `ComfyUI · ${name}`, type: 'music' as const, provider: 'comfyui' as const })),
  ...AUDIO_WORKFLOWS.map(([modelId, name]) => ({ modelId, name: `ComfyUI · ${name} Voice`, type: 'voice' as const, provider: 'comfyui' as const })),
] as const

export const COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  ...VIDEO_WORKFLOWS.map(([modelId]) => ({
    modelType: 'video' as const,
    provider: 'comfyui' as const,
    modelId,
    capabilities: { video: { supportsTextToVideo: true, supportedInputModes: ['first_frame', 'reference', 'text_to_video'] } },
  })),
  ...AUDIO_WORKFLOWS.flatMap(([modelId]) => ([
    { modelType: 'music' as const, provider: 'comfyui' as const, modelId, capabilities: { music: {} } },
    { modelType: 'voice' as const, provider: 'comfyui' as const, modelId, capabilities: { voice: {} } },
  ])),
] as const

const COMFYUI_ZERO_PRICE = { mode: 'flat' as const, unit: 'per_call' as const, flatAmount: 0 }

export const COMFYUI_BUILTIN_PRICING_CATALOG_ENTRIES = COMFYUI_API_CONFIG_CATALOG_MODELS.map((model) => ({
  apiType: model.type === 'music' ? 'music' as const : model.type === 'voice' ? 'voice' as const : 'video' as const,
  provider: 'comfyui' as const,
  modelId: model.modelId,
  cost: COMFYUI_ZERO_PRICE,
  retail: COMFYUI_ZERO_PRICE,
}))
