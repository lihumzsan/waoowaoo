import type OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const completionCreateMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'chatcmpl-openrouter-vision',
  object: 'chat.completion',
  created: 0,
  model: 'anthropic/claude-sonnet-4',
  choices: [{
    index: 0,
    finish_reason: 'stop',
    logprobs: null,
    message: { role: 'assistant', content: 'vision analysis', refusal: null },
  }],
  usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
} as OpenAI.Chat.Completions.ChatCompletion)))

const openAiConstructorMock = vi.hoisted(() => vi.fn(() => ({
  chat: {
    completions: {
      create: completionCreateMock,
    },
  },
})))

const normalizeToBase64ForGenerationMock = vi.hoisted(() => vi.fn(async (input: string) => {
  if (input === '/m/media-overlay') return 'data:image/png;base64,bWVkaWEtb3ZlcmxheQ=='
  return input
}))

vi.mock('openai', () => ({
  default: openAiConstructorMock,
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: normalizeToBase64ForGenerationMock,
}))

import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
import { runOpenRouterVisionCompletion } from '@/lib/ai-providers/openrouter/llm'

describe('OpenRouter vision adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers OpenRouter as a vision-capable provider', () => {
    expect(openRouterAdapter.completeVision).toBe(runOpenRouterVisionCompletion)
  })

  it('sends image URLs through OpenRouter chat completions instead of blocking modality support', async () => {
    const result = await runOpenRouterVisionCompletion({
      userId: 'user-1',
      providerKey: 'openrouter',
      selection: {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4',
        modelKey: 'openrouter::anthropic/claude-sonnet-4',
        variantSubKind: 'official',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'sk-openrouter',
        baseUrl: 'https://openrouter.example/v1',
      },
      textPrompt: 'Analyze this scene image.',
      imageUrls: ['/m/media-overlay'],
      temperature: 0.2,
      reasoning: true,
    })

    expect(openAiConstructorMock).toHaveBeenCalledWith({
      baseURL: 'https://openrouter.example/v1',
      apiKey: 'sk-openrouter',
    })
    expect(completionCreateMock).toHaveBeenCalledWith(
      {
        model: 'anthropic/claude-sonnet-4',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this scene image.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,bWVkaWEtb3ZlcmxheQ==' } },
          ],
        }],
        temperature: 0.2,
      },
      undefined,
    )
    expect(normalizeToBase64ForGenerationMock).toHaveBeenCalledWith('/m/media-overlay')
    expect(result.text).toBe('vision analysis')
    expect(result.logProvider).toBe('openrouter')
  })

  it('passes OpenRouter session headers for vision calls', async () => {
    await runOpenRouterVisionCompletion({
      userId: 'user-1',
      providerKey: 'openrouter',
      selection: {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4',
        modelKey: 'openrouter::anthropic/claude-sonnet-4',
        variantSubKind: 'official',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'sk-openrouter',
        baseUrl: 'https://openrouter.example/v1',
      },
      textPrompt: 'Analyze this scene image.',
      imageUrls: ['/m/media-overlay'],
      temperature: 0.2,
      reasoning: true,
      options: {
        openRouterSessionId: 'vision-session',
      },
    })

    expect(completionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4',
      }),
      {
        headers: {
          'x-session-id': 'vision-session',
        },
      },
    )
  })

  it('fails explicitly when OpenRouter vision is missing a base URL', async () => {
    await expect(runOpenRouterVisionCompletion({
      userId: 'user-1',
      providerKey: 'openrouter',
      selection: {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4',
        modelKey: 'openrouter::anthropic/claude-sonnet-4',
        variantSubKind: 'official',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'sk-openrouter',
      },
      textPrompt: 'Analyze this scene image.',
      imageUrls: ['https://example.com/overlay.png'],
      temperature: 0.2,
      reasoning: true,
    })).rejects.toThrow('PROVIDER_BASE_URL_MISSING: openrouter (vision)')
  })
})
