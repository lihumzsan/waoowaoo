import type OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'

type OpenAiClientOptions = {
  fetch?: typeof fetch
}

const completionCreateMock = vi.hoisted(() => vi.fn())

const openAiConstructorMock = vi.hoisted(() => vi.fn(() => ({
  chat: {
    completions: {
      create: completionCreateMock,
    },
  },
})))

vi.mock('openai', () => ({
  default: openAiConstructorMock,
}))

import { runOpenRouterLlmCompletion, runOpenRouterLlmStream } from '@/lib/ai-providers/openrouter/llm'

function completion(model: string): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'chatcmpl-openrouter-cache',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [{
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content: 'ok', refusal: null },
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
    },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion
}

async function* openRouterStreamChunks(): AsyncGenerator<unknown> {
  yield { choices: [{ delta: { content: 'ok' } }] }
  yield {
    choices: [],
    usage: {
      prompt_tokens: 200,
      completion_tokens: 10,
      total_tokens: 210,
      prompt_tokens_details: {
        cached_tokens: 160,
        cache_write_tokens: 20,
      },
      cost: 0.0125,
    },
  }
}

describe('OpenRouter prompt cache provider contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    completionCreateMock.mockResolvedValue(completion('anthropic/claude-sonnet-4.6'))
  })

  it('adds Claude automatic prompt caching for long string prompts without explicit blocks', async () => {
    const longPrompt = 'stable prompt '.repeat(120)

    await runOpenRouterLlmCompletion({
      modelId: 'anthropic/claude-sonnet-4.6',
      providerConfig: { apiKey: 'sk-openrouter', baseUrl: 'https://openrouter.example/v1' },
      messages: [{ role: 'user', content: longPrompt }],
      temperature: 0.2,
      reasoning: false,
      reasoningEffort: 'high',
    })

    const [body] = completionCreateMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(body.model).toBe('anthropic/claude-sonnet-4.6')
    expect(body.messages).toEqual([{ role: 'user', content: longPrompt }])
    expect(body.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('configures OpenRouter SDK clients with provider proxy fetch', async () => {
    await runOpenRouterLlmCompletion({
      modelId: 'anthropic/claude-sonnet-4.6',
      providerConfig: { apiKey: 'sk-openrouter', baseUrl: 'https://openrouter.example/v1' },
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
      reasoning: false,
      reasoningEffort: 'high',
    })

    const [options] = openAiConstructorMock.mock.calls[0] as unknown as [OpenAiClientOptions]
    expect(options.fetch).toBe(fetchWithProviderProxy)
  })

  it('sends Gemini explicit cache control only on cacheable content blocks', async () => {
    await runOpenRouterLlmCompletion({
      modelId: 'google/gemini-3.5-flash',
      providerConfig: { apiKey: 'sk-openrouter', baseUrl: 'https://openrouter.example/v1' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'stable context', cacheControl: { type: 'ephemeral', ttl: '1h' } },
          { type: 'text', text: 'dynamic question' },
        ],
      }],
      temperature: 0.2,
      reasoning: false,
      reasoningEffort: 'high',
    })

    const [body] = completionCreateMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(body.cache_control).toBeUndefined()
    expect(body.messages).toEqual([{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'stable context',
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: 'dynamic question' },
      ],
    }])
  })

  it('limits Claude explicit cache breakpoints to the four largest content blocks', async () => {
    await runOpenRouterLlmCompletion({
      modelId: 'anthropic/claude-sonnet-4.6',
      providerConfig: { apiKey: 'sk-openrouter', baseUrl: 'https://openrouter.example/v1' },
      messages: [{
        role: 'user',
        content: [1, 2, 3, 4, 5].map((index) => ({
          type: 'text' as const,
          text: `${String(index)}:${'x'.repeat(index)}`,
          cacheControl: { type: 'ephemeral' as const, ttl: '1h' as const },
        })),
      }],
      temperature: 0.2,
      reasoning: false,
      reasoningEffort: 'high',
    })

    const [body] = completionCreateMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    const [message] = body.messages as Array<{ content: Array<Record<string, unknown>> }>
    const cachedTexts = message.content
      .filter((part) => part.cache_control)
      .map((part) => part.text)
    expect(cachedTexts).toEqual(['2:xx', '3:xxx', '4:xxxx', '5:xxxxx'])
  })

  it('preserves GPT text blocks while stripping non-OpenAI cache control fields', async () => {
    await runOpenRouterLlmCompletion({
      modelId: 'openai/gpt-5.5',
      providerConfig: { apiKey: 'sk-openrouter', baseUrl: 'https://openrouter.example/v1' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'stable context', cacheControl: { type: 'ephemeral', ttl: '1h' } },
          { type: 'text', text: 'dynamic question' },
        ],
      }],
      temperature: 0.2,
      reasoning: false,
      reasoningEffort: 'minimal',
    })

    const [body] = completionCreateMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(body.cache_control).toBeUndefined()
    expect(body.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'stable context' },
        { type: 'text', text: 'dynamic question' },
      ],
    }])
  })

  it('reads OpenRouter final streaming usage cache counters and provider cost', async () => {
    completionCreateMock.mockResolvedValue(openRouterStreamChunks())

    const result = await runOpenRouterLlmStream({
      userId: 'user-1',
      selection: {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4.6',
        modelKey: 'openrouter::anthropic/claude-sonnet-4.6',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'sk-openrouter',
        baseUrl: 'https://openrouter.example/v1',
      },
      messages: [{ role: 'user', content: 'stable prompt '.repeat(120) }],
      options: { reasoning: false },
    })

    expect(result.text).toBe('ok')
    expect(result.usage).toEqual({
      promptTokens: 200,
      completionTokens: 10,
      cachedInputTokens: 160,
      cacheWriteTokens: 20,
      cacheHitRate: 0.8,
      providerCostCredits: usdToCredits(0.0125),
    })
    expect(result.completion.usage).toMatchObject({
      prompt_tokens: 200,
      completion_tokens: 10,
      prompt_tokens_details: {
        cached_tokens: 160,
        cache_write_tokens: 20,
      },
      provider_cost_credits: usdToCredits(0.0125),
    })
  })
})
