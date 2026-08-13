import { describe, expect, it } from 'vitest'
import {
  listRegisteredAiProviderAdapters,
  listRegisteredAsyncTaskProviders,
} from '@/lib/ai-providers'
import { ProviderHttpError, readProviderJsonResponse } from '@/lib/ai-providers/failure'

describe('Provider failure registry conformance', () => {
  it('requires every production provider and async instance to use the canonical failure capability', () => {
    const adapters = listRegisteredAiProviderAdapters()
    const keys = new Set(adapters.map((adapter) => adapter.providerKey))
    expect(keys.size).toBe(adapters.length)

    for (const adapter of adapters) {
      expect(adapter.failure.providerKey).toBe(adapter.providerKey)
      const source = Object.assign(new Error(`future ${adapter.providerKey} failure`), {
        name: 'FutureProviderFailure',
        code: `FUTURE_${adapter.providerKey.toUpperCase()}`,
        requestId: `${adapter.providerKey}-request`,
      })
      const failure = adapter.failure.normalize({ error: source, phase: 'result' })
      expect(failure).toMatchObject({
        version: 2,
        native: {
          name: 'FutureProviderFailure',
          message: `future ${adapter.providerKey} failure`,
          code: `FUTURE_${adapter.providerKey.toUpperCase()}`,
          requestId: `${adapter.providerKey}-request`,
        },
      })
    }

    for (const registration of listRegisteredAsyncTaskProviders()) {
      expect(keys.has(registration.providerKey)).toBe(true)
    }
  })

  it('keeps bounded native HTTP evidence when a future Provider stops returning JSON', async () => {
    const response = new Response('<html>future provider outage</html>', {
      status: 502,
      headers: {
        'content-type': 'text/html',
        'x-request-id': 'future-provider-request',
      },
    })
    const error = await readProviderJsonResponse({
      response,
      provider: 'ark',
      phase: 'result',
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderHttpError)
    expect(error).toMatchObject({
      statusCode: 502,
      requestId: 'future-provider-request',
      contentType: 'text/html',
      message: '<html>future provider outage</html>',
    })
  })
})
