import { describe, expect, it } from 'vitest'
import {
  H3_CONTINUATION_MAX_SOURCE_DURATION_MS,
  resolveH3DurationPlan,
} from '@/lib/video-generation/h3-duration'

describe('H3 duration plan', () => {
  it('caps reference at 11 seconds while the other H3 modes retain 4-15 seconds', () => {
    const fullDurations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    const referenceDurations = fullDurations.slice(0, 8)
    expect(referenceDurations.map((requestedDurationSeconds) => resolveH3DurationPlan({
      inputMode: 'reference',
      requestedDurationSeconds,
    }).requestedDurationSeconds)).toEqual(referenceDurations)
    for (const inputMode of ['first_frame', 'first_last_frame', 'continuation'] as const) {
      expect(fullDurations.map((requestedDurationSeconds) => resolveH3DurationPlan({
        inputMode,
        requestedDurationSeconds,
      }).requestedDurationSeconds)).toEqual(fullDurations)
    }
    expect(resolveH3DurationPlan({ inputMode: 'first_frame', requestedDurationSeconds: 4 })).toEqual({
      requestedDurationSeconds: 4, frameCount: 107, promptEndSeconds: 4.458,
    })
    expect(resolveH3DurationPlan({ inputMode: 'first_last_frame', requestedDurationSeconds: 15 })).toEqual({
      requestedDurationSeconds: 15, frameCount: 362, promptEndSeconds: 15.083,
    })
  })

  it('includes the 22-frame continuation guide without shortening the novel tail', () => {
    expect(resolveH3DurationPlan({ inputMode: 'continuation', requestedDurationSeconds: 4 })).toEqual({
      requestedDurationSeconds: 4, frameCount: 124, promptEndSeconds: 5.167,
    })
    expect(resolveH3DurationPlan({ inputMode: 'continuation', requestedDurationSeconds: 11 })).toEqual({
      requestedDurationSeconds: 11, frameCount: 294, promptEndSeconds: 12.25,
    })
    expect(resolveH3DurationPlan({ inputMode: 'continuation', requestedDurationSeconds: 15 })).toEqual({
      requestedDurationSeconds: 15, frameCount: 396, promptEndSeconds: 16.5,
    })
    expect(H3_CONTINUATION_MAX_SOURCE_DURATION_MS).toBe(15_625)
  })

  it.each([
    ['reference', 3], ['reference', 12], ['reference', 16], ['first_frame', 3], ['first_last_frame', 16],
    ['continuation', 3], ['continuation', 16], ['reference', 4.5], ['reference', Number.NaN],
  ] as const)('rejects unsupported %s request duration %s', (inputMode, requestedDurationSeconds) => {
    expect(() => resolveH3DurationPlan({ inputMode, requestedDurationSeconds })).toThrow(
      `H3_REQUESTED_DURATION_INVALID:${inputMode}:${String(requestedDurationSeconds)}`,
    )
  })
})
