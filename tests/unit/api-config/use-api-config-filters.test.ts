import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
  }
})

import { useApiConfigFilters } from '@/app/[locale]/profile/components/api-config-tab/hooks/useApiConfigFilters'
import type { CustomModel, Provider } from '@/app/[locale]/profile/components/api-config/types'
import {
  CODEX_DEFAULT_EXECUTABLE_PATH,
  CODEX_DEFAULT_IMAGE_MODEL_ID,
  CODEX_DEFAULT_IMAGE_MODEL_KEY,
  CODEX_DEFAULT_MODEL_KEY,
  CODEX_PROVIDER_KEY,
} from '@/lib/providers/codex/constants'

describe('api config filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses ComfyUI as the audio provider and keeps regular audio defaults only', () => {
    const providers: Provider[] = [
      { id: 'comfyui', name: 'ComfyUI', hasApiKey: false, baseUrl: 'http://127.0.0.1:8188' },
    ]
    const models: CustomModel[] = [
      {
        modelId: 'baseaudio/单人/LongCat-one',
        modelKey: 'comfyui::baseaudio/单人/LongCat-one',
        name: 'ComfyUI · LongCat 单人',
        type: 'audio',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'baseaudio/\u97f3\u8272/s2-se',
        modelKey: 'comfyui::baseaudio/\u97f3\u8272/s2-se',
        name: 'ComfyUI · S2 voice design',
        type: 'audio',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'basevideo/seedance2/bernini-480p-i2v',
        modelKey: 'comfyui::basevideo/seedance2/bernini-480p-i2v',
        name: 'ComfyUI · Seedance2.0 Bernini 480p I2V',
        type: 'video',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
    ]

    const result = useApiConfigFilters({ providers, models })
    const providerIds = result.modelProviders.map((provider) => provider.id)
    const audioDefaultIds = result.getEnabledModelsByType('audio').map((model) => model.modelId)

    expect(providerIds).toEqual(['comfyui'])
    expect(audioDefaultIds).toEqual(expect.arrayContaining([
      'baseaudio/单人/LongCat-one',
    ]))
    expect(audioDefaultIds).not.toContain('baseaudio/\u97f3\u8272/s2-se')
    expect(Object.prototype.hasOwnProperty.call(result, 'audioProviders')).toBe(false)
  })

  it('keeps modelProviders order aligned with providers input order', () => {
    const providers: Provider[] = [
      { id: 'google', name: 'Google AI Studio', hasApiKey: true, apiKey: 'k-google' },
      { id: 'openai-compatible:oa-2', name: 'OpenAI B', hasApiKey: true, apiKey: 'k-oa2' },
      { id: 'ark', name: 'Volcengine Ark', hasApiKey: true, apiKey: 'k-ark' },
    ]
    const models: CustomModel[] = [
      {
        modelId: 'gemini-3.1-pro-preview',
        modelKey: 'google::gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro',
        type: 'llm',
        provider: 'google',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'gpt-4.1',
        modelKey: 'openai-compatible:oa-2::gpt-4.1',
        name: 'GPT 4.1',
        type: 'llm',
        provider: 'openai-compatible:oa-2',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'doubao-seed-2-0-pro-260215',
        modelKey: 'ark::doubao-seed-2-0-pro-260215',
        name: 'Doubao Seed 2.0 Pro',
        type: 'llm',
        provider: 'ark',
        price: 0,
        enabled: true,
      },
    ]

    const result = useApiConfigFilters({ providers, models })
    expect(result.modelProviders.map((provider) => provider.id)).toEqual([
      'google',
      'openai-compatible:oa-2',
      'ark',
    ])
  })

  it('includes codex text and image models without requiring an api key', () => {
    const providers: Provider[] = [
      { id: CODEX_PROVIDER_KEY, name: 'Codex (Local)', hasApiKey: false, baseUrl: CODEX_DEFAULT_EXECUTABLE_PATH },
    ]
    const models: CustomModel[] = [
      {
        modelId: 'gpt-5.5',
        modelKey: CODEX_DEFAULT_MODEL_KEY,
        name: 'Codex GPT-5.5',
        type: 'llm',
        provider: CODEX_PROVIDER_KEY,
        price: 0,
        enabled: true,
      },
      {
        modelId: CODEX_DEFAULT_IMAGE_MODEL_ID,
        modelKey: CODEX_DEFAULT_IMAGE_MODEL_KEY,
        name: 'Codex Image',
        type: 'image',
        provider: CODEX_PROVIDER_KEY,
        price: 0,
        enabled: true,
      },
    ]

    const result = useApiConfigFilters({ providers, models })

    expect(result.modelProviders.map((provider) => provider.id)).toEqual([CODEX_PROVIDER_KEY])
    expect(result.getEnabledModelsByType('llm').map((model) => model.modelKey)).toEqual([
      CODEX_DEFAULT_MODEL_KEY,
    ])
    expect(result.getEnabledModelsByType('image').map((model) => model.modelKey)).toEqual([
      CODEX_DEFAULT_IMAGE_MODEL_KEY,
    ])
  })

  it('limits bailian coding plan providers to supported text models only', () => {
    const providers: Provider[] = [
      { id: 'bailian', name: 'Alibaba Bailian', hasApiKey: true, apiKey: 'sk-sp-demo' },
    ]
    const models: CustomModel[] = [
      {
        modelId: 'qwen3.5-plus',
        modelKey: 'bailian::qwen3.5-plus',
        name: 'Qwen 3.5 Plus',
        type: 'llm',
        provider: 'bailian',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'qwen3.5-flash',
        modelKey: 'bailian::qwen3.5-flash',
        name: 'Qwen 3.5 Flash',
        type: 'llm',
        provider: 'bailian',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'wan2.7-i2v',
        modelKey: 'bailian::wan2.7-i2v',
        name: 'Wan2.7 I2V',
        type: 'video',
        provider: 'bailian',
        price: 0,
        enabled: true,
      },
    ]

    const result = useApiConfigFilters({ providers, models })

    expect(result.getEnabledModelsByType('llm').map((model) => model.modelId)).toEqual(['qwen3.5-plus'])
    expect(result.getEnabledModelsByType('video')).toEqual([])
  })

  it('treats the comfyui s2 workflow as a voice-design candidate when baseUrl is present', () => {
    const providers: Provider[] = [
      { id: 'comfyui', name: 'ComfyUI', hasApiKey: false, baseUrl: 'http://127.0.0.1:8188' },
    ]
    const models: CustomModel[] = [
      {
        modelId: 'baseaudio/\u97f3\u8272/s2-se',
        modelKey: 'comfyui::baseaudio/\u97f3\u8272/s2-se',
        name: 'ComfyUI · S2 voice design',
        type: 'audio',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
    ]

    const result = useApiConfigFilters({ providers, models })

    expect(result.getEnabledModelsByType('audio')).toEqual([])
    expect(result.getEnabledModelsByType('voicedesign').map((model) => model.modelId)).toEqual([
      'baseaudio/\u97f3\u8272/s2-se',
    ])
  })
})
