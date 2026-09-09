import { describe, expect, it } from 'vitest'
import {
  H3_CONTINUATION_MAX_SOURCE_DURATION_MS,
  resolveH3DurationPlan,
} from '@/lib/video-generation/h3-duration'
import {
  resolveH3ReferenceDimensions,
  resolveH3ReferenceRuntimePlan,
} from '@/lib/video-generation/h3-reference-runtime-plan'

describe('H3 duration plan', () => {
  it('publishes the same complete 4-15 second range for every H3 mode', () => {
    const durations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    for (const inputMode of ['reference', 'first_frame', 'first_last_frame', 'continuation'] as const) {
      expect(durations.map((requestedDurationSeconds) => resolveH3DurationPlan({
        inputMode,
        requestedDurationSeconds,
      }).requestedDurationSeconds)).toEqual(durations)
    }
    expect(resolveH3DurationPlan({ inputMode: 'first_frame', requestedDurationSeconds: 4 })).toEqual({
      requestedDurationSeconds: 4, frameCount: 107, promptEndSeconds: 4.458,
    })
    expect(resolveH3DurationPlan({ inputMode: 'first_last_frame', requestedDurationSeconds: 15 })).toEqual({
      requestedDurationSeconds: 15, frameCount: 362, promptEndSeconds: 15.083,
    })
  })

  it('publishes the reference frame and MP table without interpolation', () => {
    expect([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(resolveH3ReferenceRuntimePlan)).toEqual([
      { requestedDurationSeconds: 4, frameCount: 107, promptEndSeconds: 4.458, firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
      { requestedDurationSeconds: 5, frameCount: 124, promptEndSeconds: 5.167, firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
      { requestedDurationSeconds: 6, frameCount: 158, promptEndSeconds: 6.583, firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
      { requestedDurationSeconds: 7, frameCount: 175, promptEndSeconds: 7.292, firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
      { requestedDurationSeconds: 8, frameCount: 192, promptEndSeconds: 8, firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
      { requestedDurationSeconds: 9, frameCount: 226, promptEndSeconds: 9.417, firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
      { requestedDurationSeconds: 10, frameCount: 243, promptEndSeconds: 10.125, firstPassMegapixels: 0.70, secondPassMegapixels: 1.00 },
      { requestedDurationSeconds: 11, frameCount: 277, promptEndSeconds: 11.542, firstPassMegapixels: 0.61, secondPassMegapixels: 0.88 },
      { requestedDurationSeconds: 12, frameCount: 294, promptEndSeconds: 12.25, firstPassMegapixels: 0.58, secondPassMegapixels: 0.83 },
      { requestedDurationSeconds: 13, frameCount: 328, promptEndSeconds: 13.667, firstPassMegapixels: 0.52, secondPassMegapixels: 0.75 },
      { requestedDurationSeconds: 14, frameCount: 345, promptEndSeconds: 14.375, firstPassMegapixels: 0.49, secondPassMegapixels: 0.71 },
      { requestedDurationSeconds: 15, frameCount: 362, promptEndSeconds: 15.083, firstPassMegapixels: 0.47, secondPassMegapixels: 0.67 },
    ])
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
    ['reference', 3], ['reference', 16], ['first_frame', 3], ['first_last_frame', 16],
    ['continuation', 3], ['continuation', 16], ['reference', 4.5], ['reference', Number.NaN],
  ] as const)('rejects unsupported %s request duration %s', (inputMode, requestedDurationSeconds) => {
    expect(() => resolveH3DurationPlan({ inputMode, requestedDurationSeconds })).toThrow(
      `H3_REQUESTED_DURATION_INVALID:${inputMode}:${String(requestedDurationSeconds)}`,
    )
  })

  it('matches the ComfyUI total-area formula for every H3 ratio including 9:21', () => {
    expect(resolveH3ReferenceDimensions({ megapixels: 2, aspectRatio: '16:9' })).toEqual({ width: 1920, height: 1088 })
    expect(resolveH3ReferenceDimensions({ megapixels: 2, aspectRatio: '9:21' })).toEqual({ width: 960, height: 2208 })
    expect(resolveH3ReferenceDimensions({ megapixels: 0.47, aspectRatio: '9:21' })).toEqual({ width: 448, height: 1088 })
  })
})
