import {
  beforeEach,
  chatCompletionResponse,
  describe,
  ensureAiCatalogsRegistered,
  expect,
  fetchMock,
  it,
  jsonResponse,
  requestUrlOf,
  responsesApiResponse,
  testLlmConnection,
  testProviderConnection,
  vi,
} from './provider-gateway-dispatch.fixture'

describe('provider contract - gateway dispatch (connection tests, session, capabilities)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureAiCatalogsRegistered()
  })

  describe('testLlmConnection routes through provider connection testers', () => {
    it('uses the Ark default base URL and test model when none are supplied', async () => {
      fetchMock.mockResolvedValueOnce(responsesApiResponse('doubao-seed-2-0-lite-260215', '2'))

      const result = await testLlmConnection({ provider: 'ark', apiKey: 'sk-ark' })

      const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit]
      const url = requestUrlOf(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?])
      expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(body.model).toBe('doubao-seed-2-0-lite-260215')
      expect(body.thinking).toEqual({ type: 'disabled' })
      expect(result).toEqual({
        provider: 'ark',
        message: 'ark connection ok',
        model: 'doubao-seed-2-0-lite-260215',
        answer: '2',
      })
    })

    it('uses the OpenRouter default base URL and test model when none are supplied', async () => {
      fetchMock.mockResolvedValueOnce(chatCompletionResponse('openai/gpt-4o-mini', '2'))

      const result = await testLlmConnection({ provider: 'openrouter', apiKey: 'sk-or' })

      const url = requestUrlOf(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?])
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
      expect(result.provider).toBe('openrouter')
      expect(result.model).toBe('openai/gpt-4o-mini')
    })

    it('probes the Google models endpoint and surfaces probe failures', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }))
      const ok = await testLlmConnection({ provider: 'google', apiKey: 'g-key' })
      expect(ok).toEqual({ provider: 'google', message: 'google connection ok' })
      const url = requestUrlOf(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?])
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=g-key')

      fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }))
      await expect(testLlmConnection({ provider: 'google', apiKey: 'bad' }))
        .rejects.toMatchObject({
          name: 'ProviderHttpError',
          message: 'denied',
          statusCode: 403,
        })
    })

    it('rejects providers without an LLM connection tester', async () => {
      await expect(testLlmConnection({ provider: 'elevenlabs', apiKey: 'k' }))
        .rejects.toThrow('Unsupported provider: elevenlabs')
      await expect(testLlmConnection({ provider: 'no-such-provider', apiKey: 'k' }))
        .rejects.toThrow('Unsupported provider: no-such-provider')
      expect(fetchMock.mock.calls).toEqual([])
    })
  })

  describe('testProviderConnection routes through provider diagnose testers', () => {
    it('skips text generation when the Ark models probe fails', async () => {
      fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }))

      const result = await testProviderConnection({ apiType: 'ark', apiKey: 'sk-ark' })

      expect(result.success).toBe(false)
      expect(result.steps).toEqual([
        {
          name: 'models',
          status: 'fail',
          messageKey: 'connectionTest.authInvalid',
          diagnostic: 'nope',
        },
        {
          name: 'textGen',
          status: 'skip',
          messageKey: 'connectionTest.skippedModelsFailure',
          model: 'doubao-seed-2-0-lite-260215',
        },
      ])
      const url = requestUrlOf(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?])
      expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/models')
    })

    it('probes FAL with an OPTIONS credential check and skips paid generation', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const result = await testProviderConnection({ apiType: 'fal', apiKey: 'fal-key' })

      expect(result.success).toBe(true)
      expect(result.steps).toEqual([
        { name: 'models', status: 'pass', messageKey: 'connectionTest.modelsOk' },
        { name: 'imageGen', status: 'skip', messageKey: 'connectionTest.skippedSpend' },
      ])
      const [input, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit]
      expect(String(input)).toBe('https://fal.run/fal-ai/flux/dev')
      expect(init.method).toBe('OPTIONS')
      expect(init.headers).toEqual({ Authorization: 'Key fal-key' })
    })

    it('classifies FAL credential rejections as authentication failures', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))

      const result = await testProviderConnection({ apiType: 'fal', apiKey: 'bad' })

      expect(result.success).toBe(false)
      expect(result.steps).toEqual([
        {
          name: 'models',
          status: 'fail',
          messageKey: 'connectionTest.authInvalid',
          diagnostic: 'fal returned an empty JSON response',
        },
      ])
    })

    it('probes ElevenLabs credentials without spending on music generation', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ tier: 'creator' }))
      const elevenlabs = await testProviderConnection({ apiType: 'elevenlabs', apiKey: 'k' })
      expect(elevenlabs).toEqual({
        success: true,
        steps: [
          { name: 'credits', status: 'pass', messageKey: 'connectionTest.modelsOk' },
          { name: 'musicGen', status: 'skip', messageKey: 'connectionTest.skippedSpend' },
        ],
      })
      const [input, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit]
      expect(String(input)).toBe('https://api.elevenlabs.io/v1/user/subscription')
      expect(init.method).toBe('GET')
      expect(init.headers).toEqual({ 'xi-api-key': 'k' })

      const unknown = await testProviderConnection({ apiType: 'nope', apiKey: 'k' })
      expect(unknown.steps[0]?.messageKey).toBe('connectionTest.providerError')
      expect(fetchMock.mock.calls).toHaveLength(1)
    })
  })
})
