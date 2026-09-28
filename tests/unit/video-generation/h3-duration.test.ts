import { describe, expect, it } from 'vitest'
import {
  H3_CONTINUATION_MAX_SOURCE_DURATION_MS,
  resolveH3DurationPlan,
} from '@/lib/video-generation/h3-duration'
import {
  resolveH3ReferenceDimensions,
} from '@/lib/video-generation/h3-reference-runtime-plan'

import { listH3DurationOptions, type H3InputMode } from '@/lib/video-generation/h3-runtime-policy'

describe('H3 duration plan', () => {
  it('uses the minimal 17n+5 frame grid while retaining the requested novel duration', () => {
    for (const inputMode of ['reference', 'first_frame', 'first_last_frame', 'continuation'] as const) {
      for (const requestedDurationSeconds of listH3DurationOptions(inputMode)) {
        const plan = resolveH3DurationPlan({ inputMode, requestedDurationSeconds })
        const guideFrames = inputMode === 'continuation' ? 22 : 0
        const minimumFrames = Math.max(107, requestedDurationSeconds * 24 + guideFrames)
        expect((plan.frameCount - 5) % 17).toBe(0)
        expect(plan.frameCount).toBeGreaterThanOrEqual(minimumFrames)
        expect(plan.frameCount - 17).toBeLessThan(minimumFrames)
        expect(plan.promptStartSeconds).toBe(Number((guideFrames / 24).toFixed(3)))
        expect(plan.promptEndSeconds).toBe(Number((plan.frameCount / 24).toFixed(3)))
        expect(plan.expectedOutputDurationSeconds).toBe(Number(((plan.frameCount - guideFrames) / 24).toFixed(3)))
        expect(plan.expectedOutputDurationSeconds).toBeGreaterThanOrEqual(requestedDurationSeconds)
      }
    }
    expect(H3_CONTINUATION_MAX_SOURCE_DURATION_MS).toBe(15_625)
  })

  it('rejects text-only and unknown modes explicitly', () => {
    expect(() => resolveH3DurationPlan({ inputMode: 'text_to_video', requestedDurationSeconds: 4 })).toThrow('H3_INPUT_MODE_INVALID')
    expect(() => listH3DurationOptions('unknown' as H3InputMode)).toThrow('H3_INPUT_MODE_INVALID')
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
