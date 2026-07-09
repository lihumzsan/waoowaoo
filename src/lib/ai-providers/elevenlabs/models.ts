import type { PlatformModelPreset } from '@/lib/platform-models/types'

export const ELEVENLABS_SOUND_EFFECT_MODEL_ID = 'eleven_text_to_sound_v2'
export const ELEVENLABS_PLATFORM_DEFAULT_SOUND_EFFECT_MODEL_KEY = `elevenlabs::${ELEVENLABS_SOUND_EFFECT_MODEL_ID}`

function elevenLabsFlatPricing(flatAmount: number) {
  return { mode: 'flat' as const, flatAmount }
}

export const ELEVENLABS_PLATFORM_MODEL_PRESETS = [
  {
    provider: 'elevenlabs',
    modelId: ELEVENLABS_SOUND_EFFECT_MODEL_ID,
    name: 'ElevenLabs Text to Sound v2',
    type: 'soundEffect',
  },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export const ELEVENLABS_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'soundEffect',
    provider: 'elevenlabs',
    modelId: ELEVENLABS_SOUND_EFFECT_MODEL_ID,
    capabilities: {
      soundEffect: {
        durationSecondsOptions: [0.5, 5, 10, 15, 20, 25, 30],
        loopOptions: [true],
        promptInfluenceOptions: [0.3, 0.55, 0.75],
        outputFormatOptions: ['mp3_44100_128', 'mp3_44100_192'],
      },
    },
  },
] as const

export const ELEVENLABS_API_CONFIG_CATALOG_MODELS = [
  {
    modelId: ELEVENLABS_SOUND_EFFECT_MODEL_ID,
    name: 'ElevenLabs Text to Sound v2',
    type: 'soundEffect',
    provider: 'elevenlabs',
  },
] as const

export const ELEVENLABS_BUILTIN_PRICING_CATALOG_ENTRIES = [
  {
    apiType: 'sound_effect',
    provider: 'elevenlabs',
    modelId: ELEVENLABS_SOUND_EFFECT_MODEL_ID,
    pricing: elevenLabsFlatPricing(0.12),
  },
] as const
