import { describe, expect, it } from 'vitest'
import {
  H3_DURATION_OPTIONS_SECONDS,
  resolveH3ContinuationDurationPlan,
  resolveH3DurationPlan,
} from '@/lib/video-generation/h3-duration'

describe('H3 duration plan', () => {
  it('derives the provider frame count and Prompt end timestamp from an integer request', () => {
    expect(resolveH3DurationPlan(4)).toEqual({
      requestedDurationSeconds: 4,
      frameCount: 107,
      promptEndSeconds: 4.458,
    })
    expect(resolveH3DurationPlan(8)).toEqual({
      requestedDurationSeconds: 8,
      frameCount: 192,
      promptEndSeconds: 8,
    })
  })

  it('publishes every supported request duration through the same resolver', () => {
    expect(H3_DURATION_OPTIONS_SECONDS.map((requestedDurationSeconds) => (
      resolveH3DurationPlan(requestedDurationSeconds)
    ))).toEqual([
      { requestedDurationSeconds: 4, frameCount: 107, promptEndSeconds: 4.458 },
      { requestedDurationSeconds: 5, frameCount: 124, promptEndSeconds: 5.167 },
      { requestedDurationSeconds: 6, frameCount: 158, promptEndSeconds: 6.583 },
      { requestedDurationSeconds: 7, frameCount: 175, promptEndSeconds: 7.292 },
      { requestedDurationSeconds: 8, frameCount: 192, promptEndSeconds: 8 },
      { requestedDurationSeconds: 9, frameCount: 226, promptEndSeconds: 9.417 },
      { requestedDurationSeconds: 10, frameCount: 243, promptEndSeconds: 10.125 },
      { requestedDurationSeconds: 11, frameCount: 277, promptEndSeconds: 11.542 },
      { requestedDurationSeconds: 12, frameCount: 294, promptEndSeconds: 12.25 },
      { requestedDurationSeconds: 13, frameCount: 328, promptEndSeconds: 13.667 },
    ])
  })

  it('includes the 22-frame continuation guide without shortening the requested novel tail', () => {
    expect(resolveH3ContinuationDurationPlan(4)).toEqual({
      requestedDurationSeconds: 4,
      frameCount: 124,
      promptEndSeconds: 5.167,
    })
    expect(resolveH3ContinuationDurationPlan(13)).toEqual({
      requestedDurationSeconds: 13,
      frameCount: 345,
      promptEndSeconds: 14.375,
    })
  })

  it.each([3, 4.5, 14, Number.NaN])('rejects unsupported request duration %s', (duration) => {
    expect(() => resolveH3DurationPlan(duration)).toThrow(
      `H3_REQUESTED_DURATION_INVALID:${String(duration)}`,
    )
  })
})
