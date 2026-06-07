import { describe, expect, it } from 'vitest'
import { API_CONFIG_CATALOG_PROVIDERS } from '@/lib/ai-registry/api-config-catalog'
import { resolveAiProviderAdapter, resolveAsyncTaskProviderByCode } from '@/lib/ai-providers'
import { falAdapter } from '@/lib/ai-providers/fal/adapter'

describe('provider scope', () => {
  it('registers only the supported provider set', () => {
    expect(API_CONFIG_CATALOG_PROVIDERS.map((provider) => provider.id).sort()).toEqual([
      'ark',
      'fal',
      'google',
      'openrouter',
    ])
    expect(resolveAiProviderAdapter('ark').providerKey).toBe('ark')
    expect(resolveAiProviderAdapter('openrouter').providerKey).toBe('openrouter')
    expect(resolveAiProviderAdapter('fal').providerKey).toBe('fal')
    expect(resolveAiProviderAdapter('google').providerKey).toBe('google')
  })

  it('keeps async polling limited to ark, fal, and google', () => {
    expect([
      resolveAsyncTaskProviderByCode('ARK').providerCode,
      resolveAsyncTaskProviderByCode('FAL').providerCode,
      resolveAsyncTaskProviderByCode('GEMINI').providerCode,
      resolveAsyncTaskProviderByCode('GOOGLE').providerCode,
    ].sort()).toEqual([
      'ARK',
      'FAL',
      'GEMINI',
      'GOOGLE',
    ])
  })

  it('exposes only image and video generation on FAL', () => {
    expect(Object.keys(falAdapter).sort()).toEqual(['image', 'providerKey', 'video'])
  })
})
