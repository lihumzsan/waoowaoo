import { describe, expect, it } from 'vitest'
import {
  applyCodexPresetDefaults,
  applyCodexTextPresetDefault,
  mergeProvidersForDisplay,
} from '@/app/[locale]/profile/components/api-config/selectors'
import type { CustomModel, Provider } from '@/app/[locale]/profile/components/api-config/types'
import {
  CODEX_DEFAULT_EXECUTABLE_PATH,
  CODEX_DEFAULT_IMAGE_MODEL_KEY,
  CODEX_DEFAULT_MODEL_KEY,
  CODEX_PROVIDER_KEY,
} from '@/lib/ai-providers/codex/constants'

function codexModel(type: 'llm' | 'image'): CustomModel {
  const isText = type === 'llm'
  return {
    modelId: isText ? 'gpt-5.5' : 'gpt-image-2',
    modelKey: isText ? CODEX_DEFAULT_MODEL_KEY : CODEX_DEFAULT_IMAGE_MODEL_KEY,
    name: isText ? 'Codex GPT 5.5' : 'Codex GPT Image 2',
    type,
    provider: CODEX_PROVIDER_KEY,
    price: 0,
    enabled: false,
  }
}

describe('api config Codex defaults', () => {
  it('treats Codex as ready without an api key', () => {
    const presetProviders: Provider[] = [
      { id: CODEX_PROVIDER_KEY, name: 'Codex Local', baseUrl: CODEX_DEFAULT_EXECUTABLE_PATH },
    ]
    const savedProviders: Provider[] = [
      { id: CODEX_PROVIDER_KEY, name: 'Codex Local', baseUrl: CODEX_DEFAULT_EXECUTABLE_PATH, apiKey: '' },
    ]

    const merged = mergeProvidersForDisplay(savedProviders, presetProviders)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: CODEX_PROVIDER_KEY,
      baseUrl: CODEX_DEFAULT_EXECUTABLE_PATH,
      hasApiKey: true,
    })
  })

  it('auto-selects Codex for analysis only on the migration pass', () => {
    const result = applyCodexTextPresetDefault({
      models: [codexModel('llm')],
      defaultModels: { analysisModel: 'openrouter::openai/gpt-5.4' },
      shouldAutoSelect: true,
    })

    expect(result.changed).toBe(true)
    expect(result.defaultModels.analysisModel).toBe(CODEX_DEFAULT_MODEL_KEY)
    expect(result.models[0]?.enabled).toBe(true)

    const skipped = applyCodexTextPresetDefault({
      models: result.models,
      defaultModels: { analysisModel: 'openrouter::openai/gpt-5.4' },
      shouldAutoSelect: false,
    })
    expect(skipped.changed).toBe(false)
    expect(skipped.defaultModels.analysisModel).toBe('openrouter::openai/gpt-5.4')
  })

  it('migrates empty and ComfyUI image defaults to Codex Image without replacing explicit non-ComfyUI defaults', () => {
    const result = applyCodexPresetDefaults({
      models: [codexModel('image')],
      defaultModels: {
        characterModel: 'fal::banana',
        locationModel: 'comfyui::baseimage/image-gen/legacy-scene',
      },
      shouldAutoSelectText: false,
    })

    expect(result.changed).toBe(true)
    expect(result.defaultModels).toMatchObject({
      characterModel: 'fal::banana',
      locationModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      storyboardModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      editModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
    })
    expect(result.models[0]?.enabled).toBe(true)
  })
})
