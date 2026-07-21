import { RunRawModelStreamEvent } from '@openai/agents'
import { describe, expect, it } from 'vitest'
import { createAgentsPublicReasoningNormalizer } from '@/lib/ai-exec/agents-public-reasoning'

describe('Agents public reasoning normalizer', () => {
  it('streams only readable reasoning text and never exposes provider metadata', () => {
    const normalizer = createAgentsPublicReasoningNormalizer()
    expect(normalizer.accept(new RunRawModelStreamEvent({ type: 'response_started' }))).toEqual([])
    expect(normalizer.accept(new RunRawModelStreamEvent({
      type: 'model',
      event: {
        type: 'reasoning-start',
        id: 'block-1',
        providerMetadata: { openrouter: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'secret' }] } },
      },
    }))).toEqual([])
    expect(normalizer.accept(new RunRawModelStreamEvent({
      type: 'model',
      event: { type: 'reasoning-delta', id: 'block-1', delta: 'Public ' },
    }))).toEqual([
      { kind: 'start', reasoningId: 'reasoning:1:block-1' },
      { kind: 'delta', reasoningId: 'reasoning:1:block-1', delta: 'Public ' },
    ])
    expect(normalizer.accept(new RunRawModelStreamEvent({
      type: 'model',
      event: { type: 'reasoning-delta', id: 'block-1', delta: 'summary' },
    }))).toEqual([
      { kind: 'delta', reasoningId: 'reasoning:1:block-1', delta: 'summary' },
    ])
    expect(normalizer.accept(new RunRawModelStreamEvent({
      type: 'model',
      event: { type: 'reasoning-end', id: 'block-1', providerMetadata: { signature: 'hidden' } },
    }))).toEqual([
      { kind: 'end', reasoningId: 'reasoning:1:block-1', text: 'Public summary' },
    ])
  })

  it('emits nothing for encrypted-only reasoning blocks', () => {
    const normalizer = createAgentsPublicReasoningNormalizer()
    normalizer.accept(new RunRawModelStreamEvent({ type: 'response_started' }))
    expect(normalizer.accept(new RunRawModelStreamEvent({
      type: 'model',
      event: { type: 'reasoning-start', id: 'encrypted' },
    }))).toEqual([])
    expect(normalizer.accept(new RunRawModelStreamEvent({
      type: 'model',
      event: { type: 'reasoning-end', id: 'encrypted', providerMetadata: { encrypted: 'secret' } },
    }))).toEqual([])
    expect(normalizer.finish()).toEqual([])
  })
})
