import { describe, expect, it } from 'vitest'
import { API_CONFIG_CATALOG_PROVIDERS } from '@/lib/ai-registry/api-config-catalog'
import { resolveAiProviderAdapter, resolveAsyncTaskProviderByCode } from '@/lib/ai-providers'
import { codexAdapter } from '@/lib/ai-providers/codex/adapter'
import { falAdapter } from '@/lib/ai-providers/fal/adapter'
import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
import { CODEX_API_CONFIG_CATALOG_MODELS } from '@/lib/ai-providers/codex/models'
import { OPENROUTER_API_CONFIG_CATALOG_MODELS } from '@/lib/ai-providers/openrouter/models'

describe('provider scope', () => {
  it('registers only the supported provider set', () => {
    expect(API_CONFIG_CATALOG_PROVIDERS.map((provider) => provider.id).sort()).toEqual([
      'ark',
      'codex',
      'fal',
      'google',
      'openrouter',
    ])
    expect(resolveAiProviderAdapter('ark').providerKey).toBe('ark')
    expect(resolveAiProviderAdapter('codex').providerKey).toBe('codex')
    expect(resolveAiProviderAdapter('openrouter').providerKey).toBe('openrouter')
    expect(resolveAiProviderAdapter('fal').providerKey).toBe('fal')
    expect(resolveAiProviderAdapter('google').providerKey).toBe('google')
  })

  it('keeps async polling limited to registered media async providers', () => {
    expect([
      resolveAsyncTaskProviderByCode('ARK').providerCode,
      resolveAsyncTaskProviderByCode('FAL').providerCode,
      resolveAsyncTaskProviderByCode('GEMINI').providerCode,
      resolveAsyncTaskProviderByCode('GOOGLE').providerCode,
      resolveAsyncTaskProviderByCode('OPENROUTER').providerCode,
    ].sort()).toEqual([
      'ARK',
      'FAL',
      'GEMINI',
      'GOOGLE',
      'OPENROUTER',
    ])
  })

  it('exposes image, video, and music generation on FAL', () => {
    expect(Object.keys(falAdapter).sort()).toEqual(['image', 'music', 'providerKey', 'video'])
  })

  it('exposes Codex local LLM and image models through the provider catalog', () => {
    expect(Object.keys(codexAdapter).sort()).toEqual([
      'completeLlm',
      'completeVision',
      'image',
      'languageModel',
      'providerKey',
      'streamLlm',
    ])
    expect(CODEX_API_CONFIG_CATALOG_MODELS).toContainEqual({
      modelId: 'gpt-5.5',
      name: 'Codex GPT 5.5',
      type: 'llm',
      provider: 'codex',
    })
    expect(CODEX_API_CONFIG_CATALOG_MODELS).toContainEqual({
      modelId: 'gpt-image-2',
      name: 'Codex GPT Image 2',
      type: 'image',
      provider: 'codex',
    })
  })

  it('exposes OpenRouter LLM and video models through the provider catalog', () => {
    expect(Object.keys(openRouterAdapter).sort()).toEqual([
      'completeLlm',
      'completeVision',
      'languageModel',
      'providerKey',
      'streamLlm',
      'video',
    ])
    expect(OPENROUTER_API_CONFIG_CATALOG_MODELS).toContainEqual({
      modelId: 'bytedance/seedance-2.0',
      name: 'Seedance 2.0',
      type: 'video',
      provider: 'openrouter',
    })
    expect(OPENROUTER_API_CONFIG_CATALOG_MODELS).toContainEqual({
      modelId: 'bytedance/seedance-2.0-fast',
      name: 'Seedance 2.0 Fast',
      type: 'video',
      provider: 'openrouter',
    })
  })
})
