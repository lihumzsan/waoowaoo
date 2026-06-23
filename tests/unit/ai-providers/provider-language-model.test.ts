import { beforeEach, describe, expect, it, vi } from 'vitest'

const openAiState = vi.hoisted(() => ({
  createOpenAI: vi.fn((settings: {
    apiKey?: string
    baseURL?: string
    name?: string
    headers?: Record<string, string>
    fetch?: typeof fetch
  }) => ({
    chat: vi.fn((modelId: string) => ({
      provider: settings.name,
      modelId,
      settings,
    })),
  })),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: openAiState.createOpenAI,
}))

import { createRegisteredLanguageModel } from '@/lib/ai-providers'

describe('ai provider language model registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates Ark language models from registered provider configs', () => {
    const model = createRegisteredLanguageModel({
      providerKey: 'ark',
      selection: {
        provider: 'ark',
        modelId: 'doubao-seed-1-6',
        modelKey: 'ark::doubao-seed-1-6',
      },
      providerConfig: {
        id: 'ark',
        name: 'Volcengine Ark',
        apiKey: 'sk-ark',
      },
    })

    expect(model).toMatchObject({
      provider: 'ark',
      modelId: 'doubao-seed-1-6',
    })
    expect(openAiState.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-ark',
      name: 'ark',
    })
  })

  it('creates OpenRouter language models from registered provider configs', () => {
    const model = createRegisteredLanguageModel({
      providerKey: 'openrouter',
      selection: {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4.5',
        modelKey: 'openrouter::anthropic/claude-sonnet-4.5',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'sk-openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    })

    expect(model).toMatchObject({
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.5',
    })
    expect(openAiState.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      name: 'openrouter',
      fetch: expect.any(Function),
    })
  })

  it('fails explicitly when OpenRouter language models are missing base URL', () => {
    expect(() => createRegisteredLanguageModel({
      providerKey: 'openrouter',
      selection: {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4.5',
        modelKey: 'openrouter::anthropic/claude-sonnet-4.5',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'sk-openrouter',
      },
    })).toThrow('PROVIDER_BASE_URL_MISSING: openrouter (language-model)')
    expect(openAiState.createOpenAI).not.toHaveBeenCalled()
  })

  it('passes OpenRouter session headers to AI SDK language models', () => {
    createRegisteredLanguageModel({
      providerKey: 'openrouter',
      selection: {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4.5',
        modelKey: 'openrouter::anthropic/claude-sonnet-4.5',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'sk-openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      openRouterSessionId: 'project-agent-session',
    })

    expect(openAiState.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      name: 'openrouter',
      headers: {
        'x-session-id': 'project-agent-session',
      },
      fetch: expect.any(Function),
    })
  })

  it('injects Claude prompt cache control in OpenRouter AI SDK fetch bodies', async () => {
    createRegisteredLanguageModel({
      providerKey: 'openrouter',
      selection: {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4.6',
        modelKey: 'openrouter::anthropic/claude-sonnet-4.6',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'sk-openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    })
    const settings = openAiState.createOpenAI.mock.calls[0]?.[0]
    const fetchImpl = settings?.fetch
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    await fetchImpl?.('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.6',
        messages: [{ role: 'user', content: 'stable prompt '.repeat(120) }],
      }),
    })

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'anthropic/claude-sonnet-4.6',
      messages: [{ role: 'user', content: 'stable prompt '.repeat(120) }],
      cache_control: { type: 'ephemeral', ttl: '1h' },
    })
    fetchMock.mockRestore()
  })
})
