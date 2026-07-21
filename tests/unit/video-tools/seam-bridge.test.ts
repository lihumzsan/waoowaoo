import { describe, expect, it } from 'vitest'
import { parseVideoSeamBridgeOptions } from '@/lib/video-tools/seam-bridge'

describe('video seam bridge options', () => {
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
