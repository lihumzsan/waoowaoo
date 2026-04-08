import { describe, expect, it } from 'vitest'
import { applyComfyUiPresetDefaults, mergeProvidersForDisplay } from '@/app/[locale]/profile/components/api-config/hooks'
import type { Provider } from '@/app/[locale]/profile/components/api-config/types'

describe('useProviders provider order merge', () => {
  it('preserves saved providers order and appends missing presets at the end', () => {
    const presetProviders: Provider[] = [
      { id: 'ark', name: '火山引擎 Ark' },
      { id: 'google', name: 'Google AI Studio' },
      { id: 'bailian', name: '阿里云百炼' },
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
          modelId: 'baseimage/图片分镜/Qwen剧情分镜制作',
          modelKey: 'comfyui::baseimage/图片分镜/Qwen剧情分镜制作',
          name: 'ComfyUI · Qwen 剧情分镜制作',
          type: 'image',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'baseimage/图片生成/Flux2Klein文生图',
          modelKey: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
          name: 'ComfyUI · Flux2Klein 文生图',
          type: 'image',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'baseimage/图片编辑/qwen单图编辑',
          modelKey: 'comfyui::baseimage/图片编辑/qwen单图编辑',
          name: 'ComfyUI · Qwen 单图编辑',
          type: 'image',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'basevideo/图生视频/LTX2.3图生视频快速版',
          modelKey: 'comfyui::basevideo/图生视频/LTX2.3图生视频快速版',
          name: 'ComfyUI · LTX 2.3 图生视频',
          type: 'video',
          provider: 'comfyui',
          price: 0,
          enabled: false,
        },
        {
          modelId: 'baseaudio/多人/LongCat-two',
          modelKey: 'comfyui::baseaudio/多人/LongCat-two',
          name: 'ComfyUI · LongCat 多人',
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
      characterModel: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
      locationModel: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
      storyboardModel: 'comfyui::baseimage/图片分镜/Qwen剧情分镜制作',
      editModel: 'comfyui::baseimage/图片编辑/qwen单图编辑',
      videoModel: 'comfyui::basevideo/图生视频/LTX2.3图生视频快速版',
      audioModel: 'comfyui::baseaudio/多人/LongCat-two',
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
          modelId: 'baseimage/图片生成/Flux2Klein文生图',
          modelKey: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
          name: 'ComfyUI · Flux2Klein 文生图',
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
          modelId: 'baseaudio/多人/LongCat-two',
          modelKey: 'comfyui::baseaudio/多人/LongCat-two',
          name: 'ComfyUI · LongCat 多人',
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
