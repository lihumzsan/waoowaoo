import type OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const completionCreateMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'chatcmpl-openrouter',
  object: 'chat.completion',
  created: 0,
  model: 'anthropic/claude-sonnet-4',
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
    prompt_tokens_details: {
      cached_tokens: 80,
      cache_write_tokens: 10,
    },
  },
} as unknown as OpenAI.Chat.Completions.ChatCompletion)))

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

import { runOpenRouterLlmCompletion } from '@/lib/ai-providers/openrouter/llm'
import {
  buildOpenRouterSessionId,
  normalizeOpenRouterSessionId,
} from '@/lib/ai-providers/openrouter/session'

describe('OpenRouter session and cache accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes custom session ids to OpenRouter-safe bounded strings', () => {
    const normalized = normalizeOpenRouterSessionId(` project agent/session ${'x'.repeat(300)} `)

    expect(normalized).toBeDefined()
    expect(normalized?.length).toBeLessThanOrEqual(256)
    expect(normalized?.startsWith('project_agent')).toBe(true)
    expect(normalized).not.toContain(' ')
  })

  it('builds stable app session ids from workflow scope', () => {
    const left = buildOpenRouterSessionId({
      kind: 'project-agent',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      modelKey: 'openrouter::anthropic/claude-sonnet-4',
    })
    const right = buildOpenRouterSessionId({
      kind: 'project-agent',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      modelKey: 'openrouter::anthropic/claude-sonnet-4',
    })

    expect(left).toBe(right)
    expect(left).toMatch(/^waoowaoo:project-agent:workspace-command:/)
    expect(left?.length).toBeLessThanOrEqual(256)
  })

  it('sends x-session-id and exposes OpenRouter cache tokens from usage', async () => {
    const result = await runOpenRouterLlmCompletion({
      modelId: 'anthropic/claude-sonnet-4',
      providerConfig: {
        apiKey: 'sk-openrouter',
        baseUrl: 'https://openrouter.example/v1',
      },
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
      reasoning: false,
      reasoningEffort: 'high',
      maxRetries: 0,
      openRouterSessionId: 'project:assistant session',
    })

    expect(openAiConstructorMock).toHaveBeenCalledWith({
      baseURL: 'https://openrouter.example/v1',
      apiKey: 'sk-openrouter',
    })
    expect(completionCreateMock).toHaveBeenCalledWith(
      {
        model: 'anthropic/claude-sonnet-4',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.2,
      },
      {
        headers: {
          'x-session-id': 'project:assistant_session',
        },
      },
    )
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 5,
      cachedInputTokens: 80,
      cacheWriteTokens: 10,
      cacheHitRate: 0.8,
    })
    expect(result.successDetails).toMatchObject({
      engine: 'openai_sdk',
      openRouterSessionId: 'project:assistant_session',
      openRouterResponse: {
        id: 'chatcmpl-openrouter',
        usage: {
          prompt_tokens_details: {
            cached_tokens: 80,
            cache_write_tokens: 10,
          },
        },
      },
    })
  })
})
