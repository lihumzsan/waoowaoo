import { describe, expect, it } from 'vitest'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'
import {
  parseStoredAiLlmExecutionResult,
  projectAiSdkLanguageModelResult,
} from '@/lib/ai-exec/llm/result-projector'

describe('AI SDK LLM result projector', () => {
  it('preserves cache accounting, provider cost, reasoning, and termination in one domain result', () => {
    const projected = projectAiSdkLanguageModelResult({
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
      result: {
        text: 'answer',
        reasoningText: 'reasoning',
        finishReason: 'content-filter',
        rawFinishReason: 'safety',
        usage: {
          inputTokens: 100,
          inputTokenDetails: {
            noCacheTokens: 55,
            cacheReadTokens: 40,
            cacheWriteTokens: 5,
          },
          outputTokens: 20,
          outputTokenDetails: { textTokens: 12, reasoningTokens: 8 },
          totalTokens: 120,
        },
        response: {
          id: 'response-1',
          modelId: 'upstream-model',
          timestamp: new Date('2026-01-02T03:04:05.000Z'),
        },
        providerMetadata: {
          openrouter: {
            provider: 'Anthropic',
            usage: {
              promptTokens: 100,
              completionTokens: 20,
              totalTokens: 120,
              cost: 0.25,
            },
          },
        },
      },
    })

    expect(projected).toMatchObject({
      schemaVersion: 1,
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
      text: 'answer',
      reasoning: 'reasoning',
      termination: { kind: 'safety', rawReason: 'safety' },
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cachedInputTokens: 40,
        cacheWriteTokens: 5,
        cacheHitRate: 0.4,
        providerCostCredits: usdToCredits(0.25),
      },
      response: {
        id: 'response-1',
        modelId: 'upstream-model',
        timestamp: '2026-01-02T03:04:05.000Z',
      },
    })
    expect(parseStoredAiLlmExecutionResult(JSON.parse(JSON.stringify(projected)))).toEqual(projected)
  })

  it('rejects pre-cutover ChatCompletion-shaped durable results', () => {
    expect(() => parseStoredAiLlmExecutionResult({ id: 'chatcmpl-old', choices: [] }))
      .toThrow('TASK_LLM_INVOCATION_RESULT_INVALID:schemaVersion')
  })
})
