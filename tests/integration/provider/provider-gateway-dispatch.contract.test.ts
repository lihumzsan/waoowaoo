import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { testLlmConnection } from '@/lib/ai-exec/llm-test-connection'
import { testProviderConnection } from '@/lib/ai-exec/provider-test'
import { supportsAssetReferenceMultiReferenceVideoModel } from '@/lib/ai-registry/video-model-helpers'
import { arkAdapter } from '@/lib/ai-providers/ark/adapter'
import { googleAdapter } from '@/lib/ai-providers/google/adapter'
import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
import {
  buildOpenRouterSessionId,
  normalizeOpenRouterSessionId,
} from '@/lib/ai-providers/openrouter/session'
import {
  FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_VIDEO_MODEL_ID,
} from '@/lib/ai-providers/fal/models'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

vi.mock('@/lib/http/outbound-proxy', () => ({
  fetchWithProviderProxy: fetchMock,
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function chatCompletionResponse(model: string, answer: string): Response {
  return jsonResponse({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [{
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content: answer, refusal: null },
    }],
  })
}

function requestUrlOf(call: [RequestInfo | URL, RequestInit?]): string {
  const [input] = call
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

describe('provider contract - gateway dispatch (connection tests, session, capabilities)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureAiCatalogsRegistered()
  })

  describe('testLlmConnection routes through provider connection testers', () => {
    it('uses the Ark default base URL and test model when none are supplied', async () => {
      fetchMock.mockResolvedValueOnce(chatCompletionResponse('doubao-seed-2-0-lite-260215', '2'))

      const result = await testLlmConnection({ provider: 'ark', apiKey: 'sk-ark' })

      const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit]
      const url = requestUrlOf(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?])
      expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions')
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(body.model).toBe('doubao-seed-2-0-lite-260215')
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
        .rejects.toThrow('Google AI probe failed (403): denied')
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
        { name: 'models', status: 'fail', message: 'Authentication failed - check API Key' },
        {
          name: 'textGen',
          status: 'skip',
          message: 'Skipped because models probe failed',
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
        { name: 'models', status: 'pass', message: 'FAL credential accepted for provider probe' },
        { name: 'imageGen', status: 'skip', message: 'Generation probe skipped to avoid spend' },
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
        { name: 'models', status: 'fail', message: 'Authentication failed (403)' },
      ])
    })

    it('reports unsupported providers without a diagnose tester', async () => {
      const elevenlabs = await testProviderConnection({ apiType: 'elevenlabs', apiKey: 'k' })
      expect(elevenlabs).toEqual({
        success: false,
        steps: [{ name: 'models', status: 'fail', message: 'Unsupported API type: elevenlabs' }],
      })

      const unknown = await testProviderConnection({ apiType: 'nope', apiKey: 'k' })
      expect(unknown.steps[0]?.message).toBe('Unsupported API type: nope')
      expect(fetchMock.mock.calls).toEqual([])
    })
  })

  describe('LLM session ids are derived by the owning provider adapter', () => {
    it('derives the OpenRouter session id exactly like the session module', () => {
      const derived = openRouterAdapter.resolveLlmSessionId?.({
        kind: 'llm',
        userId: 'user-1',
        projectId: 'project-1',
        action: 'analyze',
        modelKey: 'openrouter::openai/gpt-5.5',
      })
      expect(derived).toBe(buildOpenRouterSessionId({
        kind: 'llm',
        userId: 'user-1',
        projectId: 'project-1',
        action: 'analyze',
        modelKey: 'openrouter::openai/gpt-5.5',
      }))
      expect(derived).toBeTruthy()
    })

    it('prefers a normalized explicit session id over derivation', () => {
      const explicit = openRouterAdapter.resolveLlmSessionId?.({
        kind: 'vision',
        userId: 'user-1',
        modelKey: 'openrouter::openai/gpt-5.5',
        explicitSessionId: '  My Session!!  ',
      })
      expect(explicit).toBe(normalizeOpenRouterSessionId('  My Session!!  '))
      expect(explicit).toBe('My_Session')
    })

    it('leaves providers without a session concept undefined', () => {
      expect(arkAdapter.resolveLlmSessionId).toBeUndefined()
      expect(googleAdapter.resolveLlmSessionId).toBeUndefined()
    })
  })

  describe('asset-reference multi-reference video capability comes from the catalog', () => {
    it('declares all Ark video models as multi-reference capable', () => {
      expect(supportsAssetReferenceMultiReferenceVideoModel('ark::doubao-seedance-2-0-260128')).toBe(true)
      expect(supportsAssetReferenceMultiReferenceVideoModel('ark::doubao-seedance-2-0-fast-260128')).toBe(true)
      expect(supportsAssetReferenceMultiReferenceVideoModel('ark::doubao-seedance-1-0-pro-250528-batch')).toBe(true)
    })

    it('declares exactly the supported FAL video models as multi-reference capable', () => {
      for (const modelId of [
        FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
        FAL_SEEDANCE_2_VIDEO_MODEL_ID,
        FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
        FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
        FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
        FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
        FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
      ]) {
        expect(supportsAssetReferenceMultiReferenceVideoModel(`fal::${modelId}`)).toBe(true)
      }
      expect(supportsAssetReferenceMultiReferenceVideoModel('fal::fal-ai/kling-video/v2.5-turbo/pro/image-to-video')).toBe(false)
    })

    it('rejects undeclared providers, unknown models, and bare model ids', () => {
      expect(supportsAssetReferenceMultiReferenceVideoModel('openrouter::bytedance/seedance-2.0')).toBe(false)
      expect(supportsAssetReferenceMultiReferenceVideoModel('ark::no-such-model')).toBe(false)
      expect(supportsAssetReferenceMultiReferenceVideoModel('doubao-seedance-2-0-260128')).toBe(false)
    })
  })
})
