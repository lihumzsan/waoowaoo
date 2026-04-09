import { describe, expect, it } from 'vitest'
import { applyComfyUiPresetDefaults, mergeProvidersForDisplay } from '@/app/[locale]/profile/components/api-config/hooks'
import type { Provider } from '@/app/[locale]/profile/components/api-config/types'

describe('useProviders provider order merge', () => {
  it('preserves saved providers order and appends missing presets at the end', () => {
    const presetProviders: Provider[] = [
      { id: 'ark', name: 'Volcengine Ark' },
      { id: 'google', name: 'Google AI Studio' },
      { id: 'bailian', name: 'Alibaba Bailian' },
    ]
    const savedProviders: Provider[] = [
      { id: 'google', name: 'Google Legacy Name', apiKey: 'google-key', hidden: true },
      { id: 'openai-compatible:oa-2', name: 'OpenAI B', baseUrl: 'https://oa-b.test', apiKey: 'oa-key' },
      { id: 'ark', name: 'Ark Legacy Name', apiKey: 'ark-key' },
    ]

    const merged = mergeProvidersForDisplay(savedProviders, presetProviders)

    expect(merged.map((provider) => provider.id)).toEqual([
      'google',
      'openai-compatible:oa-2',
      'ark',
      'bailian',
    ])
    expect(merged[0]?.hidden).toBe(true)
  })

  it('uses preset localized names for preset providers while keeping apiKey/baseUrl from saved data', () => {
    const presetProviders: Provider[] = [
      { id: 'google', name: 'Google AI Studio', baseUrl: 'https://google.default' },
    ]
    const savedProviders: Provider[] = [
      { id: 'google', name: 'Google Old Name', baseUrl: 'https://google.custom', apiKey: 'google-key' },
    ]

    const merged = mergeProvidersForDisplay(savedProviders, presetProviders)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: 'google',
      name: 'Google AI Studio',
      baseUrl: 'https://google.custom',
      apiKey: 'google-key',
      hasApiKey: true,
    })
  })

  it('uses preset official baseUrl for minimax even when saved payload contains a custom baseUrl', () => {
    const presetProviders: Provider[] = [
      { id: 'minimax', name: 'MiniMax Hailuo', baseUrl: 'https://api.minimaxi.com/v1' },
    ]
    const savedProviders: Provider[] = [
      { id: 'minimax', name: 'MiniMax Legacy', baseUrl: 'https://custom.minimax.proxy/v1', apiKey: 'mm-key' },
    ]

    const merged = mergeProvidersForDisplay(savedProviders, presetProviders)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: 'minimax',
      name: 'MiniMax Hailuo',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'mm-key',
      hasApiKey: true,
    })
  })

  it('treats comfyui as ready when a baseUrl is available even without an apiKey', () => {
    const presetProviders: Provider[] = [
      { id: 'comfyui', name: 'ComfyUI (Local)', baseUrl: 'http://127.0.0.1:8188' },
    ]
    const savedProviders: Provider[] = [
      { id: 'comfyui', name: 'ComfyUI (Local)', baseUrl: 'http://127.0.0.1:8188', apiKey: '' },
    ]

    const merged = mergeProvidersForDisplay(savedProviders, presetProviders)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: 'comfyui',
      baseUrl: 'http://127.0.0.1:8188',
      hasApiKey: true,
    })
  })

  it('applies comfyui fallback defaults and enables the default workflows', () => {
    const result = applyComfyUiPresetDefaults({
      models: [
        {
          modelId: 'baseimage/\u56fe\u7247\u5206\u955c/Qwen\u5267\u60c5\u5206\u955c\u5236\u4f5c',
          modelKey: 'comfyui::baseimage/\u56fe\u7247\u5206\u955c/Qwen\u5267\u60c5\u5206\u955c\u5236\u4f5c',
          name: 'ComfyUI · Qwen storyboard',
          type: 'image',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'baseimage/\u56fe\u7247\u751f\u6210/Flux2Klein\u6587\u751f\u56fe',
          modelKey: 'comfyui::baseimage/\u56fe\u7247\u751f\u6210/Flux2Klein\u6587\u751f\u56fe',
          name: 'ComfyUI · Flux2Klein image',
          type: 'image',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'baseimage/\u56fe\u7247\u7f16\u8f91/qwen\u5355\u56fe\u7f16\u8f91',
          modelKey: 'comfyui::baseimage/\u56fe\u7247\u7f16\u8f91/qwen\u5355\u56fe\u7f16\u8f91',
          name: 'ComfyUI · Qwen edit',
          type: 'image',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'basevideo/\u56fe\u751f\u89c6\u9891/LTX2.3\u56fe\u751f\u89c6\u9891\u5feb\u901f\u7248',
          modelKey: 'comfyui::basevideo/\u56fe\u751f\u89c6\u9891/LTX2.3\u56fe\u751f\u89c6\u9891\u5feb\u901f\u7248',
          name: 'ComfyUI · LTX 2.3 video',
          type: 'video',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'baseaudio/\u591a\u4eba/LongCat-two',
          modelKey: 'comfyui::baseaudio/\u591a\u4eba/LongCat-two',
          name: 'ComfyUI · LongCat multi',
          type: 'audio',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'baseaudio/\u97f3\u8272/s2-se',
          modelKey: 'comfyui::baseaudio/\u97f3\u8272/s2-se',
          name: 'ComfyUI · S2 voice design',
          type: 'audio',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
      ],
      defaultModels: {},
    })

    expect(result.changed).toBe(true)
    expect(result.defaultModels).toMatchObject({
      characterModel: 'comfyui::baseimage/\u56fe\u7247\u751f\u6210/Flux2Klein\u6587\u751f\u56fe',
      locationModel: 'comfyui::baseimage/\u56fe\u7247\u751f\u6210/Flux2Klein\u6587\u751f\u56fe',
      storyboardModel: 'comfyui::baseimage/\u56fe\u7247\u5206\u955c/Qwen\u5267\u60c5\u5206\u955c\u5236\u4f5c',
      editModel: 'comfyui::baseimage/\u56fe\u7247\u7f16\u8f91/qwen\u5355\u56fe\u7f16\u8f91',
      videoModel: 'comfyui::basevideo/\u56fe\u751f\u89c6\u9891/LTX2.3\u56fe\u751f\u89c6\u9891\u5feb\u901f\u7248',
      audioModel: 'comfyui::baseaudio/\u591a\u4eba/LongCat-two',
      voiceDesignModel: 'comfyui::baseaudio/\u97f3\u8272/s2-se',
    })
    expect(result.models.every((model) => model.enabled)).toBe(true)
  })

  it('does not overwrite an existing explicit default model selection', () => {
    const result = applyComfyUiPresetDefaults({
      models: [
        {
          modelId: 'custom-image-model',
          modelKey: 'custom::image-model',
          name: 'Custom Image Model',
          type: 'image',
          provider: 'custom',
          price: 0,
          enabled: true,
        },
        {
          modelId: 'baseimage/\u56fe\u7247\u751f\u6210/Flux2Klein\u6587\u751f\u56fe',
          modelKey: 'comfyui::baseimage/\u56fe\u7247\u751f\u6210/Flux2Klein\u6587\u751f\u56fe',
          name: 'ComfyUI · Flux2Klein image',
          type: 'image',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
      ],
      defaultModels: {
        characterModel: 'custom::image-model',
      },
    })

    expect(result.defaultModels.characterModel).toBe('custom::image-model')
    expect(result.models[1]?.enabled).toBe(true)
  })

  it('does not overwrite an existing explicit audio default model selection', () => {
    const result = applyComfyUiPresetDefaults({
      models: [
        {
          modelId: 'custom-audio-model',
          modelKey: 'custom::audio-model',
          name: 'Custom Audio Model',
          type: 'audio',
          provider: 'custom',
          price: 0,
          enabled: true,
        },
        {
          modelId: 'baseaudio/\u591a\u4eba/LongCat-two',
          modelKey: 'comfyui::baseaudio/\u591a\u4eba/LongCat-two',
          name: 'ComfyUI · LongCat multi',
          type: 'audio',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
      ],
      defaultModels: {
        audioModel: 'custom::audio-model',
      },
    })

    expect(result.defaultModels.audioModel).toBe('custom::audio-model')
    expect(result.models[1]?.enabled).toBe(true)
  })
})
