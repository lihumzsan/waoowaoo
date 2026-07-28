import { RunRawModelStreamEvent } from '@openai/agents'
import { describe, expect, it } from 'vitest'
import {
  readCreativeWorkerGenerationBoundary,
  readCreativeWorkerOutputDelta,
} from '@/lib/creative-worker/model-stream'

describe('Creative Worker model stream', () => {
  it('projects only raw output text as transient structured-output delta', () => {
    expect(readCreativeWorkerOutputDelta(new RunRawModelStreamEvent({
      type: 'output_text_delta',
      delta: '{"kind":"screen',
    }))).toBe('{"kind":"screen')

    expect(readCreativeWorkerOutputDelta(new RunRawModelStreamEvent({
      type: 'response_started',
    }))).toBeNull()
  })

  it('projects truthful model generation boundaries without inventing reasoning text', () => {
    expect(readCreativeWorkerGenerationBoundary(new RunRawModelStreamEvent({
      type: 'response_started',
    }))).toBe('started')
    expect(readCreativeWorkerGenerationBoundary(new RunRawModelStreamEvent({
      type: 'response_done',
      response: {
        id: 'response-1',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        output: [],
      },
    }))).toBe('completed')
    expect(readCreativeWorkerGenerationBoundary(new RunRawModelStreamEvent({
      type: 'output_text_delta',
      delta: '{}',
    }))).toBeNull()
  })
})
