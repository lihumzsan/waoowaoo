import { beforeEach, describe, expect, it, vi } from 'vitest'

const openAiState = vi.hoisted(() => ({
  createOpenAI: vi.fn((settings: { apiKey?: string; baseURL?: string; name?: string }) => ({
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
    })
  })
})
