import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_SEAM_BRIDGE_MOTION_PROMPT,
  DEFAULT_VIDEO_SEAM_BRIDGE_DURATION,
  parseVideoSeamBridgeOptions,
} from '@/lib/video-tools/seam-bridge'

const GENERIC_MOTION_PROMPT = 'Create one continuous cinematic transition between the exact first and last frame. Begin visible motion immediately from the first generated frame and maintain perceptible camera, subject, and environment motion through every intermediate frame. When the endpoint compositions differ, continuously evolve framing, subjects, and setting toward the final frame instead of holding either reference image. Prioritize the exact endpoints. No cut, no dissolve, no fade, no overlay, no freeze frame, no static hold.'

describe('video seam bridge options', () => {
  it('defaults bridge duration to one second', () => {
    expect(DEFAULT_VIDEO_SEAM_BRIDGE_DURATION).toBe(1)
  })

  it('writes the generic motion prompt when none is supplied', () => {
    expect(DEFAULT_VIDEO_SEAM_BRIDGE_MOTION_PROMPT).toBe(GENERIC_MOTION_PROMPT)
    expect(parseVideoSeamBridgeOptions({ durationSeconds: 4 }))
      .toEqual({ durationSeconds: 4, prompt: GENERIC_MOTION_PROMPT })
  })

  it('accepts every bridge duration exposed by the video tools UI', () => {
    for (const durationSeconds of [1, 2, 3, 4, 5, 6]) {
      expect(parseVideoSeamBridgeOptions({ durationSeconds, prompt: '  Keep the same subject and camera movement.  ' }))
        .toEqual({ durationSeconds, prompt: 'Keep the same subject and camera movement.' })
    }
  })

  it('rejects unsupported bridge durations', () => {
    expect(() => parseVideoSeamBridgeOptions({ durationSeconds: 7 }))
      .toThrow('VIDEO_SEAM_BRIDGE_DURATION_INVALID')
  })
})
