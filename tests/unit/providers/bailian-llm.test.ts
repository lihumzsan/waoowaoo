import { beforeEach, describe, expect, it, vi } from 'vitest'

const createChatCompletionMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'chatcmpl_bailian',
    object: 'chat.completion',
    created: 1,
    model: 'qwen3.5-plus',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  })),
)

const openAiCtorMock = vi.hoisted(() =>
  vi.fn(() => ({
    chat: {
      completions: {
        create: createChatCompletionMock,
      },
    },
  })),
)

vi.mock('openai', () => ({
  default: openAiCtorMock,
}))

import { completeBailianLlm } from '@/lib/providers/bailian/llm'

describe('bailian llm provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.BAILIAN_LLM_TIMEOUT_MS
  })

  it('calls dashscope openai-compatible endpoint for registered qwen model', async () => {
    const completion = await completeBailianLlm({
      modelId: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'bl-key',
      temperature: 0.2,
    })

    expect(openAiCtorMock).toHaveBeenCalledWith({
      apiKey: 'bl-key',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      timeout: 180_000,
    })
    expect(createChatCompletionMock).toHaveBeenCalledWith({
      model: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
    })
    expect(completion.choices[0]?.message?.content).toBe('ok')
  })

  it('routes sk-sp api keys to bailian coding endpoint', async () => {
    await completeBailianLlm({
      modelId: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'sk-sp-demo',
    })

    expect(openAiCtorMock).toHaveBeenCalledWith({
      apiKey: 'sk-sp-demo',
      baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
      timeout: 180_000,
    })
  })

  it('respects configured bailian timeout override', async () => {
    process.env.BAILIAN_LLM_TIMEOUT_MS = '5000'

    await completeBailianLlm({
      modelId: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'bl-key',
    })

    expect(openAiCtorMock).toHaveBeenCalledWith({
      apiKey: 'bl-key',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      timeout: 5000,
    })
  })

  it('accepts newly registered coding plan llm models', async () => {
    await completeBailianLlm({
      modelId: 'glm-5',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'sk-sp-demo',
    })

    expect(createChatCompletionMock).toHaveBeenCalledWith({
      model: 'glm-5',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
    })
  })

  it('fails fast when model is not in official bailian catalog', async () => {
    await expect(
      completeBailianLlm({
        modelId: 'qwen-plus',
        messages: [{ role: 'user', content: 'hello' }],
        apiKey: 'bl-key',
      }),
    ).rejects.toThrow(/MODEL_NOT_REGISTERED/)

    expect(openAiCtorMock).not.toHaveBeenCalled()
    expect(createChatCompletionMock).not.toHaveBeenCalled()
  })

  it('fails with a hard timeout when the provider request never returns', async () => {
    vi.useFakeTimers()
    try {
      process.env.BAILIAN_LLM_TIMEOUT_MS = '5'
      createChatCompletionMock.mockImplementationOnce(() => new Promise(() => {}))

      const pending = completeBailianLlm({
        modelId: 'qwen3.5-plus',
        messages: [{ role: 'user', content: 'hello' }],
        apiKey: 'bl-key',
      })

      const assertion = expect(pending).rejects.toThrow(/Request timed out/i)
      await vi.advanceTimersByTimeAsync(5)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
