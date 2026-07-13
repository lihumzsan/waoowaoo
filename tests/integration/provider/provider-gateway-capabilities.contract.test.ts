import {
  FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_VIDEO_MODEL_ID,
  arkAdapter,
  beforeEach,
  buildOpenRouterSessionId,
  chatCompletionResponse,
  describe,
  ensureAiCatalogsRegistered,
  expect,
  fetchMock,
  googleAdapter,
  it,
  normalizeOpenRouterSessionId,
  openRouterAdapter,
  supportsAssetReferenceMultiReferenceVideoModel,
  vi,
} from './provider-gateway-dispatch.fixture'
import { afterEach } from 'vitest'
import { generateText } from 'ai'
import { listBuiltinCapabilityCatalog } from '@/lib/ai-registry/capabilities-catalog'
import {
  OPENROUTER_GPT_5_6_LUNA_MODEL_ID,
  OPENROUTER_GPT_5_6_REASONING_EFFORT_OPTIONS,
  OPENROUTER_GPT_5_6_SOL_MODEL_ID,
  OPENROUTER_GPT_5_6_TERRA_MODEL_ID,
} from '@/lib/ai-providers/openrouter/models'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'
import { describeLlmVariantBase } from '@/lib/ai-exec/llm-descriptor'
import { validateAiOptions } from '@/lib/ai-exec/normalize'

const ORIGINAL_REASONING_ENV = {
  PROVIDER_CREDENTIAL_MODE: process.env.PROVIDER_CREDENTIAL_MODE,
  PLATFORM_DEFAULT_ASSISTANT_REASONING_EFFORT: process.env.PLATFORM_DEFAULT_ASSISTANT_REASONING_EFFORT,
  PLATFORM_DEFAULT_ANALYSIS_REASONING_EFFORT: process.env.PLATFORM_DEFAULT_ANALYSIS_REASONING_EFFORT,
}

function restoreEnvValue(name: keyof typeof ORIGINAL_REASONING_ENV): void {
  const value = ORIGINAL_REASONING_ENV[name]
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

async function requestBodyOf(call: [RequestInfo | URL, RequestInit?]): Promise<Record<string, unknown>> {
  const [input, init] = call
  const bodyText = typeof init?.body === 'string'
    ? init.body
    : input instanceof Request
      ? await input.clone().text()
      : ''
  return JSON.parse(bodyText) as Record<string, unknown>
}

describe('provider contract - gateway dispatch (connection tests, session, capabilities)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureAiCatalogsRegistered()
  })

  afterEach(() => {
    restoreEnvValue('PROVIDER_CREDENTIAL_MODE')
    restoreEnvValue('PLATFORM_DEFAULT_ASSISTANT_REASONING_EFFORT')
    restoreEnvValue('PLATFORM_DEFAULT_ANALYSIS_REASONING_EFFORT')
  })

  describe('GPT-5.6 reasoning effort is registry-owned and exact on the wire', () => {
    it('registers Luna, Terra, and Sol with their complete OpenRouter effort set', () => {
      const catalog = listBuiltinCapabilityCatalog()

      for (const modelId of [
        OPENROUTER_GPT_5_6_LUNA_MODEL_ID,
        OPENROUTER_GPT_5_6_TERRA_MODEL_ID,
        OPENROUTER_GPT_5_6_SOL_MODEL_ID,
      ]) {
        const entry = catalog.find((candidate) => (
          candidate.modelType === 'llm'
          && candidate.provider === 'openrouter'
          && candidate.modelId === modelId
        ))
        expect(entry?.capabilities?.llm?.reasoningEffortOptions)
          .toEqual([...OPENROUTER_GPT_5_6_REASONING_EFFORT_OPTIONS])
      }
    })

    it('accepts max and rejects unsupported minimal before provider execution', () => {
      const selection = {
        provider: 'openrouter',
        modelId: OPENROUTER_GPT_5_6_LUNA_MODEL_ID,
        modelKey: `openrouter::${OPENROUTER_GPT_5_6_LUNA_MODEL_ID}`,
        variantSubKind: 'official' as const,
      }
      const schema = describeLlmVariantBase({
        modality: 'llm',
        selection,
        executionMode: 'sync',
      }).optionSchema

      expect(() => validateAiOptions({ schema, options: { reasoningEffort: 'max' }, context: 'test' }))
        .not.toThrow()
      expect(() => validateAiOptions({ schema, options: { reasoningEffort: 'minimal' }, context: 'test' }))
        .toThrow('AI_OPTION_INVALID:test:reasoningEffort:unsupported_value=minimal')
    })

    it('resolves assistant and analysis effort from separate platform env keys', async () => {
      process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
      process.env.PLATFORM_DEFAULT_ASSISTANT_REASONING_EFFORT = 'max'
      process.env.PLATFORM_DEFAULT_ANALYSIS_REASONING_EFFORT = 'xhigh'

      await expect(resolveReasoningEffort({
        userId: 'user-1',
        modelKey: `openrouter::${OPENROUTER_GPT_5_6_LUNA_MODEL_ID}`,
        purpose: 'assistant',
      })).resolves.toBe('max')
      await expect(resolveReasoningEffort({
        userId: 'user-1',
        modelKey: `openrouter::${OPENROUTER_GPT_5_6_SOL_MODEL_ID}`,
        purpose: 'analysis',
      })).resolves.toBe('xhigh')

      process.env.PLATFORM_DEFAULT_ASSISTANT_REASONING_EFFORT = 'minimal'
      await expect(resolveReasoningEffort({
        userId: 'user-1',
        modelKey: `openrouter::${OPENROUTER_GPT_5_6_LUNA_MODEL_ID}`,
        purpose: 'assistant',
      })).rejects.toThrow('CAPABILITY_VALUE_NOT_ALLOWED')
    })

    it('preserves max in OpenRouter text and vision request bodies', async () => {
      fetchMock.mockImplementation(async () => (
        chatCompletionResponse(OPENROUTER_GPT_5_6_LUNA_MODEL_ID, 'ok')
      ))
      const selection = {
        provider: 'openrouter',
        modelId: OPENROUTER_GPT_5_6_LUNA_MODEL_ID,
        modelKey: `openrouter::${OPENROUTER_GPT_5_6_LUNA_MODEL_ID}`,
        variantSubKind: 'official' as const,
      }
      const providerConfig = {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.ai/api/v1',
      }
      const completeLlm = openRouterAdapter.completeLlm
      const completeVision = openRouterAdapter.completeVision
      if (!completeLlm || !completeVision) throw new Error('OpenRouter LLM adapters are required')

      await completeLlm({
        userId: 'user-1',
        providerKey: 'openrouter',
        selection,
        providerConfig,
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        reasoning: true,
        reasoningEffort: 'max',
      })
      const textBody = await requestBodyOf(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?])
      expect(textBody.reasoning).toEqual({ effort: 'max' })

      await completeVision({
        userId: 'user-1',
        providerKey: 'openrouter',
        selection,
        providerConfig,
        textPrompt: 'describe',
        imageUrls: ['data:image/png;base64,aGVsbG8='],
        temperature: 0.7,
        reasoning: true,
        reasoningEffort: 'max',
      })
      const visionBody = await requestBodyOf(fetchMock.mock.calls[1] as [RequestInfo | URL, RequestInit?])
      expect(visionBody.reasoning).toEqual({ effort: 'max' })
    })

    it('injects max into the internal Assistant language-model request', async () => {
      fetchMock.mockResolvedValueOnce(chatCompletionResponse(OPENROUTER_GPT_5_6_SOL_MODEL_ID, 'ok'))
      const languageModelProvider = openRouterAdapter.languageModel
      if (!languageModelProvider) throw new Error('OpenRouter language model adapter is required')
      const model = languageModelProvider.create({
        providerKey: 'openrouter',
        selection: {
          provider: 'openrouter',
          modelId: OPENROUTER_GPT_5_6_SOL_MODEL_ID,
          modelKey: `openrouter::${OPENROUTER_GPT_5_6_SOL_MODEL_ID}`,
        },
        providerConfig: {
          id: 'openrouter',
          name: 'OpenRouter',
          apiKey: 'test-key',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
        reasoningEffort: 'max',
      })

      await generateText({ model, prompt: 'hello', maxRetries: 0 })

      const body = await requestBodyOf(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?])
      expect(body.reasoning).toEqual({ effort: 'max' })
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
