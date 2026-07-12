import { describe, expect, it } from 'vitest'
import { resolveUnstreamedFinalText } from '@/lib/ai-providers/shared/llm-support'

describe('LLM stream finalization', () => {
  it('emits the complete final text when the provider only exposes it at finalization', () => {
    expect(resolveUnstreamedFinalText('', '{"shots":[{"shotRef":"shot-001"}]}')).toBe(
      '{"shots":[{"shotRef":"shot-001"}]}',
    )
  })

  it('emits only a final tail and refuses to concatenate a divergent completion', () => {
    expect(resolveUnstreamedFinalText('{"shots":[', '{"shots":[{"shotRef":"shot-001"}]}')).toBe(
      '{"shotRef":"shot-001"}]}',
    )
    expect(resolveUnstreamedFinalText('partial-a', 'different-b')).toBe('')
  })
})
