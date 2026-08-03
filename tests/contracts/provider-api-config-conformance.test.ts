import { describe, expect, it } from 'vitest'
import { BUILTIN_API_CONFIG_CATALOG_MODELS } from '@/lib/ai-providers/builtin-catalog'
import { tryResolveAiProviderAdapter } from '@/lib/ai-providers'
import {
  API_CONFIG_CATALOG_PROVIDERS,
  isApiConfigCatalogProviderId,
} from '@/lib/ai-registry/api-config-catalog'
import PLATFORM_PROVIDER_ENV from '@/lib/deployment/platform-provider-env.json'
import { ApiError } from '@/lib/api-errors'
import { normalizeProvidersInput } from '@/lib/user-api/api-config-provider-normalization'
import { normalizeProviderRuntimeBaseUrl } from '@/lib/ai-registry/runtime-selection'

describe('API config provider registry conformance', () => {
  it('keeps every catalog provider executable, configurable, and platform-declared', () => {
    const catalogProviderIds = API_CONFIG_CATALOG_PROVIDERS.map((provider) => provider.id)
    expect(new Set(catalogProviderIds).size).toBe(catalogProviderIds.length)

    const modelProviderIds = Array.from(new Set(
      BUILTIN_API_CONFIG_CATALOG_MODELS.map((model) => model.provider),
    )).sort()
    expect(modelProviderIds).toEqual([...catalogProviderIds].sort())
    expect(Object.keys(PLATFORM_PROVIDER_ENV).sort()).toEqual([...catalogProviderIds].sort())

    for (const provider of API_CONFIG_CATALOG_PROVIDERS) {
      expect(isApiConfigCatalogProviderId(provider.id)).toBe(true)
      expect(tryResolveAiProviderAdapter(provider.id)).not.toBeNull()
      expect(normalizeProviderRuntimeBaseUrl(provider.id)).toBe(provider.baseUrl)
      expect(normalizeProvidersInput([provider])).toEqual([{
        id: provider.id,
        name: provider.name,
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        hidden: false,
      }])
    }
  })

  it('continues to reject identities outside the production catalog', () => {
    try {
      normalizeProvidersInput([{ id: 'unknown-provider', name: 'Unknown' }])
      throw new Error('EXPECTED_PROVIDER_NOT_SUPPORTED')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiError)
      const apiError = error as ApiError
      expect(apiError.code).toBe('INVALID_PARAMS')
      expect(apiError.details).toMatchObject({
        code: 'PROVIDER_NOT_SUPPORTED',
        field: 'providers[0].id',
      })
    }
  })
})
