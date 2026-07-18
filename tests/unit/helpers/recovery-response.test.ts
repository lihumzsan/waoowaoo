import { describe, expect, it } from 'vitest'
import { parseRecoverableRuns } from '@/lib/query/hooks/run-stream/recovery-response'

describe('recovery response parser', () => {
  it('accepts an empty runs array', () => {
    expect(parseRecoverableRuns({ runs: [] })).toEqual([])
  })

  it.each([
    { runs: [{}] },
    { runs: [null] },
  ])('rejects malformed non-empty runs rows', (payload) => {
    expect(() => parseRecoverableRuns(payload)).toThrow(
      'Invalid active runs response',
    )
  })
})
