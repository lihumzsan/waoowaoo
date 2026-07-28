import { RunRawModelStreamEvent } from '@openai/agents'
import { describe, expect, it } from 'vitest'
import { readCreativeWorkerOutputDelta } from '@/lib/creative-worker/model-stream'

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
})
