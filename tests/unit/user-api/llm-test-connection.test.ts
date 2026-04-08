import { beforeEach, describe, expect, it, vi } from 'vitest'

const openAIState = vi.hoisted(() => ({
  modelList: vi.fn(async () => ({ data: [] })),
  create: vi.fn(async () => ({
    model: 'gpt-4.1-mini',
    choices: [{ message: { content: '2' } }],
  })),
}))

const fetchMock = vi.hoisted(() =>
  vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/compatible-mode/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'qwen-plus' }] }), { status: 200 })
    }
    if (url.includes('coding.dashscope.aliyuncs.com/v1/models')) {
      return new Response('not-found', { status: 404 })
    }
    if (url.includes('coding.dashscope.aliyuncs.com/v1/chat/completions')) {
      const payload = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { model?: string }
        : {}

      if (payload.model === 'invalid-model') {
        return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 400 })
      }

      if (payload.model === 'qwen3.5-plus' || payload.model === 'glm-5' || payload.model === 'kimi-k2.5') {
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'pong' } }],
        }), { status: 200 })
      }

      return new Response('not-found', { status: 404 })
    }
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'Qwen/Qwen3-32B' }] }), { status: 200 })
    }
    if (url.endsWith('/v1/user/info')) {
      return new Response(JSON.stringify({ data: { balance: '9.8000' } }), { status: 200 })
    }
    return new Response('not-found', { status: 404 })
  }),
)

vi.mock('openai', () => ({
  default: class OpenAI {
    models = {
      list: openAIState.modelList,
    }
    chat = {
      completions: {
        create: openAIState.create,
      },
    }
  },
}))

import { testLlmConnection } from '@/lib/user-api/llm-test-connection'

describe('llm test connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('tests openai-compatible provider via openai-style endpoint', async () => {
    const result = await testLlmConnection({
      provider: 'openai-compatible',
      apiKey: 'oa-key',
      baseUrl: 'https://compat.example.com/v1',
      model: 'gpt-4.1-mini',
    })

    expect(result.provider).toBe('openai-compatible')
    expect(result.message).toContain('openai-compatible')
    expect(result.model).toBe('gpt-4.1-mini')
    expect(result.answer).toBe('2')
    expect(openAIState.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4.1-mini',
      max_tokens: 10,
      temperature: 0,
    }))

    const createCalls = openAIState.create.mock.calls as unknown as Array<
      [{ messages?: Array<{ role?: string; content?: string }> }]
    >
    const firstPayload = createCalls[0]?.[0]

    expect(firstPayload?.messages).toEqual([
      { role: 'user', content: expect.any(String) },
    ])
  })

  it('requires baseUrl for gemini-compatible provider', async () => {
    await expect(testLlmConnection({
      provider: 'gemini-compatible',
      apiKey: 'gm-key',
    })).rejects.toThrow(/baseUrl/)
  })

  it('tests bailian provider via zero-inference probe', async () => {
    const result = await testLlmConnection({
      provider: 'bailian',
      apiKey: 'bl-key',
    })

    expect(result.provider).toBe('bailian')
    expect(result.message).toContain('bailian')
    expect(result.model).toBe('qwen-plus')
  })

  it('tests bailian coding provider via text probe', async () => {
    const result = await testLlmConnection({
      provider: 'bailian',
      apiKey: 'sk-sp-demo',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-sp-demo',
          'Content-Type': 'application/json',
        }),
      }),
    )
    expect(result.provider).toBe('bailian')
    expect(result.message).toContain('bailian')
    expect(result.model).toBe('qwen3.5-plus')
    expect(result.answer).toBe('pong')
  })

  it('falls back from an invalid requested coding plan model', async () => {
    const result = await testLlmConnection({
      provider: 'bailian',
      apiKey: 'sk-sp-demo',
      model: 'invalid-model',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"model":"invalid-model"'),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"model":"qwen3.5-plus"'),
      }),
    )
    expect(result.model).toBe('qwen3.5-plus')
    expect(result.answer).toBe('pong')
  })

  it('tests siliconflow provider via zero-inference probes', async () => {
    const result = await testLlmConnection({
      provider: 'siliconflow',
      apiKey: 'sf-key',
    })

    expect(result.provider).toBe('siliconflow')
    expect(result.message).toContain('siliconflow')
    expect(result.model).toBe('Qwen/Qwen3-32B')
    expect(result.answer).toBe('balance=9.8000')
  })
})
