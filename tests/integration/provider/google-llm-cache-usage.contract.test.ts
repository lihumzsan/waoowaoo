import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateContentMock = vi.hoisted(() => vi.fn())
const googleGenAiConstructorMock = vi.hoisted(() => vi.fn(() => ({
  models: {
    generateContent: generateContentMock,
  },
})))

vi.mock('@google/genai', () => ({
  GoogleGenAI: googleGenAiConstructorMock,
}))

import { runGoogleLlmCompletion } from '@/lib/ai-providers/google/llm'

describe('Google Gemini implicit cache usage contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateContentMock.mockResolvedValue({
      candidates: [{
        content: { parts: [{ text: 'ok' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 5_000,
        candidatesTokenCount: 12,
        totalTokenCount: 5_012,
        cachedContentTokenCount: 4_096,
      },
    })
  })

  it('records Google implicit cache hit tokens from usageMetadata', async () => {
    const result = await runGoogleLlmCompletion({
      apiKey: 'sk-google',
      modelId: 'gemini-3.5-flash',
      messages: [{ role: 'user', content: 'stable context' }],
      temperature: 0.2,
      reasoning: false,
      reasoningEffort: 'high',
      logProvider: 'google',
    })

    expect(result.text).toBe('ok')
    expect(result.usage).toEqual({
      promptTokens: 5_000,
      completionTokens: 12,
      cachedInputTokens: 4_096,
      cacheHitRate: 4_096 / 5_000,
    })
    expect(result.completion.usage).toMatchObject({
      prompt_tokens: 5_000,
      completion_tokens: 12,
      prompt_tokens_details: {
        cached_tokens: 4_096,
        cache_write_tokens: 0,
      },
    })

    const [request] = generateContentMock.mock.calls[0] as [Record<string, unknown>]
    expect(request).toMatchObject({
      model: 'gemini-3.5-flash',
      config: { temperature: 0.2 },
    })
    expect(request).not.toHaveProperty('cache_control')
  })
})
