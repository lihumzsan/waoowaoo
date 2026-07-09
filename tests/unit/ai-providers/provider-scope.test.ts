import { describe, expect, it } from 'vitest'
import { API_CONFIG_CATALOG_PROVIDERS } from '@/lib/ai-registry/api-config-catalog'
import { resolveAiProviderAdapter, resolveAsyncTaskProviderByCode } from '@/lib/ai-providers'
import { falAdapter } from '@/lib/ai-providers/fal/adapter'
import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
import { elevenLabsAdapter } from '@/lib/ai-providers/elevenlabs/adapter'
import { OPENROUTER_API_CONFIG_CATALOG_MODELS } from '@/lib/ai-providers/openrouter/models'

describe('provider scope', () => {
  it('registers only the supported provider set', () => {
    expect(API_CONFIG_CATALOG_PROVIDERS.map((provider) => provider.id).sort()).toEqual([
      'ark',
      'elevenlabs',
      'fal',
      'google',
      'openrouter',
    ])
    expect(resolveAiProviderAdapter('ark').providerKey).toBe('ark')
    expect(resolveAiProviderAdapter('openrouter').providerKey).toBe('openrouter')
    expect(resolveAiProviderAdapter('fal').providerKey).toBe('fal')
    expect(resolveAiProviderAdapter('google').providerKey).toBe('google')
    expect(resolveAiProviderAdapter('elevenlabs').providerKey).toBe('elevenlabs')
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

  it('exposes sound effect generation on ElevenLabs', () => {
    expect(Object.keys(elevenLabsAdapter).sort()).toEqual(['providerKey', 'soundEffect'])
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
