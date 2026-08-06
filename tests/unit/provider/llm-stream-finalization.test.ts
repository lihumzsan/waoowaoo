import { describe, expect, it } from 'vitest'
import { reconcileAiSdkStreamFinal } from '@/lib/ai-exec/llm/result-projector'
import { validateGoogleLanguageModelResult } from '@/lib/ai-providers/google/language-model'
import { validateOpenRouterLanguageModelResult } from '@/lib/ai-providers/openrouter/language-model'
import type { AiLlmExecutionResult } from '@/lib/ai-registry/types'

function result(input: {
  text?: string
  termination?: AiLlmExecutionResult['termination']
} = {}): AiLlmExecutionResult {
  return {
    schemaVersion: 1,
    provider: 'test',
    modelId: 'test-model',
    text: input.text ?? 'answer',
    reasoning: '',
    termination: input.termination ?? { kind: 'normal', rawReason: 'stop' },
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    response: {},
  }
}

describe('LLM stream finalization', () => {
  it('emits a final-only result when the provider streamed no text', () => {
    expect(reconcileAiSdkStreamFinal('', '{"shots":[{"shotRef":"shot-001"}]}', 'text')).toEqual({
      value: '{"shots":[{"shotRef":"shot-001"}]}',
      suffix: '{"shots":[{"shotRef":"shot-001"}]}',
    })
  })

  it('emits only the final suffix when it extends the streamed text', () => {
    expect(reconcileAiSdkStreamFinal('{"shots":[', '{"shots":[{"shotRef":"shot-001"}]}', 'text')).toEqual({
      value: '{"shots":[{"shotRef":"shot-001"}]}',
      suffix: '{"shotRef":"shot-001"}]}',
    })
  })

  it('fails closed when stream and final results come from divergent content', () => {
    expect(() => reconcileAiSdkStreamFinal('partial-a', 'different-b', 'text'))
      .toThrow('LLM_STREAM_FINAL_MISMATCH:text')
  })
})

describe('provider result validation preserves execution-mode semantics', () => {
  it('classifies OpenRouter stream safety and abnormal EOF without changing vision behavior', () => {
    expect(() => validateOpenRouterLanguageModelResult(result({
      termination: { kind: 'safety', rawReason: 'content_filter' },
    }), { executionMode: 'stream' })).toThrow('OpenRouter blocked the response for safety reasons')
    expect(() => validateOpenRouterLanguageModelResult(result({
      termination: { kind: 'unknown', rawReason: 'other' },
    }), { executionMode: 'stream' })).toThrow('without a recognized final status')
    expect(() => validateOpenRouterLanguageModelResult(result({
      text: '',
      termination: { kind: 'token_limit', rawReason: 'length' },
    }), { executionMode: 'vision' })).not.toThrow()
  })

  it('preserves Google safety as an explicit terminal rejection in every execution mode', () => {
    const safetyEmpty = result({
      text: '',
      termination: { kind: 'safety', rawReason: 'SAFETY' },
    })
    expect(() => validateGoogleLanguageModelResult(safetyEmpty, { executionMode: 'sync' }))
      .toThrow('Google blocked generation by policy')
    expect(() => validateGoogleLanguageModelResult(safetyEmpty, { executionMode: 'stream' }))
      .toThrow('Google blocked generation by policy')
    expect(() => validateGoogleLanguageModelResult(safetyEmpty, { executionMode: 'vision' }))
      .toThrow('Google blocked generation by policy')
  })
})
