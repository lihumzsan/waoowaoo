import { describe, expect, it } from 'vitest'
import {
  getAddableModelTypesForProvider,
  groupComfyUiModelsByCategory,
  getVisibleModelTypesForProvider,
  parseComfyUiWorkflowParts,
  shouldShowOpenAICompatVideoHint,
} from '@/app/[locale]/profile/components/api-config/provider-card/ProviderAdvancedFields'
import {
  buildCustomPricingFromModelForm,
  buildProviderConnectionPayload,
} from '@/app/[locale]/profile/components/api-config/provider-card/hooks/useProviderCardState'

describe('provider card pricing form behavior', () => {
  it('allows openai-compatible provider to add llm/image/video', () => {
    expect(getAddableModelTypesForProvider('openai-compatible:oa-1')).toEqual(['llm', 'image', 'video'])
  })

  it('shows llm/image/video tabs by default for openai-compatible even with only image models', () => {
    const visible = getVisibleModelTypesForProvider(
      'openai-compatible:oa-1',
      {
        image: [
          {
            modelId: 'gpt-image-1',
            modelKey: 'openai-compatible:oa-1::gpt-image-1',
            name: 'Image',
            type: 'image',
            provider: 'openai-compatible:oa-1',
            price: 0,
            enabled: true,
          },
        ],
      },
    )

    expect(visible).toEqual(['llm', 'image', 'video'])
  })

  it('shows the openai-compatible video hint only for openai-compatible video add forms', () => {
    expect(shouldShowOpenAICompatVideoHint('openai-compatible:oa-1', 'video')).toBe(true)
    expect(shouldShowOpenAICompatVideoHint('openai-compatible:oa-1', 'image')).toBe(false)
    expect(shouldShowOpenAICompatVideoHint('gemini-compatible:gm-1', 'video')).toBe(false)
    expect(shouldShowOpenAICompatVideoHint('ark', 'video')).toBe(false)
  })

  it('parses comfyui workflow ids into root, category, and workflow parts', () => {
    expect(parseComfyUiWorkflowParts('baseimage/图片编辑/qwen单图编辑')).toEqual({
      root: 'baseimage',
      category: '图片编辑',
      workflow: 'qwen单图编辑',
    })

    expect(parseComfyUiWorkflowParts('baseaudio/多人/LongCat-two')).toEqual({
      root: 'baseaudio',
      category: '多人',
      workflow: 'LongCat-two',
    })

    expect(parseComfyUiWorkflowParts('baseaudio/音色/s2-se')).toEqual({
      root: 'baseaudio',
      category: '音色',
      workflow: 's2-se',
    })
  })

  it('groups comfyui models by second-level category', () => {
    const groups = groupComfyUiModelsByCategory([
      {
        modelId: 'baseimage/图片生成/Flux2Klein文生图',
        modelKey: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
        name: 'ComfyUI · Flux2Klein 文生图',
        type: 'image',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'baseimage/图片编辑/qwen单图编辑',
        modelKey: 'comfyui::baseimage/图片编辑/qwen单图编辑',
        name: 'ComfyUI · Qwen 单图编辑',
        type: 'image',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'baseimage/图片编辑/qwen双图编辑',
        modelKey: 'comfyui::baseimage/图片编辑/qwen双图编辑',
        name: 'ComfyUI · Qwen 双图编辑',
        type: 'image',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      key: 'baseimage/图片生成',
      root: 'baseimage',
      category: '图片生成',
    })
    expect(groups[0]?.models).toHaveLength(1)
    expect(groups[1]).toMatchObject({
      key: 'baseimage/图片编辑',
      root: 'baseimage',
      category: '图片编辑',
    })
    expect(groups[1]?.models.map((model) => model.modelId)).toEqual([
      'baseimage/图片编辑/qwen单图编辑',
      'baseimage/图片编辑/qwen双图编辑',
    ])
  })

  it('groups comfyui audio workflows by second-level category', () => {
    const groups = groupComfyUiModelsByCategory([
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
        modelId: 'baseaudio/多人/LongCat-two',
        modelKey: 'comfyui::baseaudio/多人/LongCat-two',
        name: 'ComfyUI · LongCat 多人',
        type: 'audio',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'baseaudio/多人/s2-two',
        modelKey: 'comfyui::baseaudio/多人/s2-two',
        name: 'ComfyUI · S2 多人',
        type: 'audio',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'baseaudio/三人/s2-three',
        modelKey: 'comfyui::baseaudio/三人/s2-three',
        name: 'ComfyUI · S2 三人',
        type: 'audio',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
      {
        modelId: 'baseaudio/音色/s2-se',
        modelKey: 'comfyui::baseaudio/音色/s2-se',
        name: 'ComfyUI · S2 音色',
        type: 'audio',
        provider: 'comfyui',
        price: 0,
        enabled: true,
      },
    ])

    expect(groups).toHaveLength(4)
    expect(groups.map((group) => group.key)).toEqual([
      'baseaudio/单人',
      'baseaudio/多人',
      'baseaudio/三人',
      'baseaudio/音色',
    ])
    expect(groups[1]?.models.map((model) => model.modelId)).toEqual([
      'baseaudio/多人/LongCat-two',
      'baseaudio/多人/s2-two',
    ])
    expect(groups[3]?.models.map((model) => model.modelId)).toEqual([
      'baseaudio/音色/s2-se',
    ])
  })

  it('shows the audio tab when the provider has audio models', () => {
    const visible = getVisibleModelTypesForProvider(
      'comfyui',
      {
        image: [
          {
            modelId: 'baseimage/图片生成/Flux2Klein文生图',
            modelKey: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
            name: 'ComfyUI · Flux2Klein 文生图',
            type: 'image',
            provider: 'comfyui',
            price: 0,
            enabled: true,
          },
        ],
        audio: [
          {
            modelId: 'baseaudio/多人/LongCat-two',
            modelKey: 'comfyui::baseaudio/多人/LongCat-two',
            name: 'ComfyUI · LongCat 多人',
            type: 'audio',
            provider: 'comfyui',
            price: 0,
            enabled: true,
          },
        ],
      },
    )

    expect(visible).toEqual(['image', 'audio'])
  })

  it('keeps payload without customPricing when pricing toggle is off', () => {
    const result = buildCustomPricingFromModelForm(
      'image',
      {
        name: 'Image',
        modelId: 'gpt-image-1',
        enableCustomPricing: false,
        basePrice: '0.8',
      },
      { needsCustomPricing: true },
    )

    expect(result).toEqual({ ok: true })
  })

  it('builds llm customPricing payload when pricing toggle is on', () => {
    const result = buildCustomPricingFromModelForm(
      'llm',
      {
        name: 'GPT',
        modelId: 'gpt-4.1',
        enableCustomPricing: true,
        priceInput: '2.5',
        priceOutput: '8',
      },
      { needsCustomPricing: true },
    )

    expect(result).toEqual({
      ok: true,
      customPricing: {
        llm: {
          inputPerMillion: 2.5,
          outputPerMillion: 8,
        },
      },
    })
  })

  it('builds media customPricing payload with option prices when enabled', () => {
    const result = buildCustomPricingFromModelForm(
      'video',
      {
        name: 'Sora',
        modelId: 'sora-2',
        enableCustomPricing: true,
        basePrice: '0.9',
        optionPricesJson: '{"resolution":{"720x1280":0.1},"duration":{"8":0.4}}',
      },
      { needsCustomPricing: true },
    )

    expect(result).toEqual({
      ok: true,
      customPricing: {
        video: {
          basePrice: 0.9,
          optionPrices: {
            resolution: {
              '720x1280': 0.1,
            },
            duration: {
              '8': 0.4,
            },
          },
        },
      },
    })
  })

  it('rejects invalid media optionPrices JSON when enabled', () => {
    const result = buildCustomPricingFromModelForm(
      'image',
      {
        name: 'Image',
        modelId: 'gpt-image-1',
        enableCustomPricing: true,
        basePrice: '0.3',
        optionPricesJson: '{"resolution":{"1024x1024":"free"}}',
      },
      { needsCustomPricing: true },
    )

    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('bugfix: includes baseUrl for openai-compatible provider connection test payload', () => {
    const payload = buildProviderConnectionPayload({
      providerKey: 'openai-compatible',
      apiKey: ' sk-test ',
      baseUrl: ' https://api.openai-proxy.example/v1 ',
    })

    expect(payload).toEqual({
      apiType: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai-proxy.example/v1',
    })
  })

  it('omits baseUrl for non-compatible provider connection test payload', () => {
    const payload = buildProviderConnectionPayload({
      providerKey: 'ark',
      apiKey: ' ark-key ',
      baseUrl: ' https://ignored.example/v1 ',
    })

    expect(payload).toEqual({
      apiType: 'ark',
      apiKey: 'ark-key',
    })
  })

  it('includes llmModel in provider connection test payload when configured', () => {
    const payload = buildProviderConnectionPayload({
      providerKey: 'openai-compatible',
      apiKey: ' sk-test ',
      baseUrl: ' https://compat.example.com/v1 ',
      llmModel: ' gpt-4.1-mini ',
    })

    expect(payload).toEqual({
      apiType: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://compat.example.com/v1',
      llmModel: 'gpt-4.1-mini',
    })
  })
})
