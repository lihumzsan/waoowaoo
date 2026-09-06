import { describe, expect, it, vi } from 'vitest'
import {
  COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
  COMFYUI_API_CONFIG_CATALOG_MODELS,
  COMFYUI_ACE_STEP_1_5_MODEL_ID,
  COMFYUI_H3_MODEL_ID,
  COMFYUI_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  COMFYUI_PLATFORM_MODEL_PRESETS,
  COMFYUI_REGISTERED_MODEL_KEYS,
  resolveComfyUiRuntimeTargetIdForModelKey,
} from '@/lib/ai-providers/comfyui/models'
import { COMFYUI_MUSIC_PROFILES } from '@/lib/ai-providers/comfyui/music-profiles'
import { comfyuiAdapter } from '@/lib/ai-providers/comfyui/adapter'
import { COMFYUI_RUNTIME_TARGET_IDS } from '@/lib/ai-providers/comfyui/config'
import { formatComfyUiExternalId, parseComfyUiExternalId } from '@/lib/ai-providers/comfyui/external-id'
import { getPlatformDefaultModels } from '@/lib/platform-models/catalog'
import { getPlatformCapabilityDefaults, getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'

describe('ComfyUI runtime target registry', () => {
  it('covers every registered catalog model exactly once', () => {
    const catalogKeys = COMFYUI_API_CONFIG_CATALOG_MODELS
      .map((model) => `comfyui::${model.modelId}`)
      .sort()

    expect([...COMFYUI_REGISTERED_MODEL_KEYS].sort()).toEqual(catalogKeys)
    expect(new Set(COMFYUI_REGISTERED_MODEL_KEYS).size).toBe(COMFYUI_REGISTERED_MODEL_KEYS.length)

    for (const modelKey of COMFYUI_REGISTERED_MODEL_KEYS) {
      expect(resolveComfyUiRuntimeTargetIdForModelKey(modelKey)).toMatch(/^(shared|h3-dual-stage-2mp)$/)
    }
  })

  it('gives every music profile an unambiguous target, canonical MP3 output and adapter schema', () => {
    expect(new Set(COMFYUI_MUSIC_PROFILES.map((profile) => profile.modelKey)).size).toBe(COMFYUI_MUSIC_PROFILES.length)
    for (const profile of COMFYUI_MUSIC_PROFILES) {
      expect(COMFYUI_RUNTIME_TARGET_IDS).toContain(profile.runtimeTargetId)
      expect(profile.modelKey).toBe(`comfyui::${profile.modelId}`)
      expect(profile.outputNodeId).toBe('107')
      expect(profile.workflow[profile.outputNodeId]).toMatchObject({ class_type: 'SaveAudioAdvanced', inputs: { format: 'mp3', 'format.quality': 'V0' } })
      const descriptor = comfyuiAdapter.music!.describe({ provider: 'comfyui', modelId: profile.modelId, modelKey: profile.modelKey, variantSubKind: 'official' })
      expect(descriptor.optionSchema).toBe(profile.optionSchema)
      expect(descriptor.capabilities.music).toEqual(profile.capabilities)
      const externalId = formatComfyUiExternalId({ targetId: profile.runtimeTargetId, type: 'MUSIC', requestId: '00000000-0000-4000-8000-000000000004' })
      expect(parseComfyUiExternalId(externalId)).toMatchObject({ endpoint: profile.runtimeTargetId, type: 'MUSIC' })
    }
  })

  it('derives every music catalog, preset, runtime target and default exactly once from production profiles', () => {
    const profileKeys = COMFYUI_MUSIC_PROFILES.map((profile) => profile.modelKey).sort()
    const capabilityKeys = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES
      .filter((entry) => entry.modelType === 'music')
      .map((entry) => `${entry.provider}::${entry.modelId}`)
      .sort()
    const apiConfigKeys = COMFYUI_API_CONFIG_CATALOG_MODELS
      .filter((entry) => entry.type === 'music')
      .map((entry) => `${entry.provider}::${entry.modelId}`)
      .sort()
    const presetKeys = COMFYUI_PLATFORM_MODEL_PRESETS
      .filter((entry) => entry.type === 'music')
      .map((entry) => `${entry.provider}::${entry.modelId}`)
      .sort()
    const registeredMusicKeys = COMFYUI_REGISTERED_MODEL_KEYS
      .filter((modelKey) => profileKeys.includes(modelKey))
      .sort()
    expect(capabilityKeys).toEqual(profileKeys)
    expect(apiConfigKeys).toEqual(profileKeys)
    expect(presetKeys).toEqual(profileKeys)
    expect(registeredMusicKeys).toEqual(profileKeys)

    vi.stubEnv('PLATFORM_MUSIC_DURATION_SECONDS', '')
    vi.stubEnv('PLATFORM_MUSIC_OUTPUT_FORMAT', '')
    try {
      const capabilityDefaults = getPlatformCapabilityDefaults()
      for (const profile of COMFYUI_MUSIC_PROFILES) {
        expect(resolveComfyUiRuntimeTargetIdForModelKey(profile.modelKey)).toBe(profile.runtimeTargetId)
        expect(capabilityDefaults[profile.modelKey]).toMatchObject(profile.defaultGenerationOptions)
      }
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('uses MiniMax Music 3 as the prompt-music platform default on the H3 runtime', () => {
    const minimax = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => (
      entry.modelType === 'music' && entry.modelId === 'minimax-music-3'
    ))

    expect(minimax).toMatchObject({
      capabilities: {
        music: {
          generationModes: ['prompt'],
          durationSecondsRange: { min: 1, max: 360 },
          vocalModeOptions: ['instrumental', 'vocal'],
          outputFormatOptions: ['mp3'],
        },
      },
    })
    expect(COMFYUI_PLATFORM_DEFAULT_MUSIC_MODEL_KEY).toBe('comfyui::minimax-music-3')
    vi.stubEnv('PLATFORM_DEFAULT_MUSIC_MODEL', '')
    try {
      expect(getPlatformDefaultModels().musicModel).toBe('comfyui::minimax-music-3')
    } finally {
      vi.unstubAllEnvs()
    }
    expect(resolveComfyUiRuntimeTargetIdForModelKey('comfyui::minimax-music-3')).toBe('h3-dual-stage-2mp')
  })

  it('isolates H3, keeps ACE on shared, and exposes no sound default', () => {
    expect(resolveComfyUiRuntimeTargetIdForModelKey(`comfyui::${COMFYUI_H3_MODEL_ID}`)).toBe('h3-dual-stage-2mp')
    expect(resolveComfyUiRuntimeTargetIdForModelKey(`comfyui::${COMFYUI_ACE_STEP_1_5_MODEL_ID}`)).toBe('shared')
    expect(getPlatformDefaultModels().soundModel).toBeUndefined()
    expect(() => getPlatformRuntimePlan('sound')).toThrow('PLATFORM_RUNTIME_MODEL_MISSING:sound')
  })
})
