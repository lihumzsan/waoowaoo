import { describe, expect, it } from 'vitest'
import { parseVideoSeamBridgeOptions } from '@/lib/video-tools/seam-bridge'

describe('video seam bridge options', () => {
  it('accepts supported durations and trims a custom continuity prompt', () => {
    expect(parseVideoSeamBridgeOptions({ durationSeconds: 6, prompt: '  Keep the same subject and camera movement.  ' }))
      .toEqual({ durationSeconds: 6, prompt: 'Keep the same subject and camera movement.' })
  })

  it('rejects unsupported bridge durations', () => {
    expect(() => parseVideoSeamBridgeOptions({ durationSeconds: 5 }))
      .toThrow('VIDEO_SEAM_BRIDGE_DURATION_INVALID')
  })
})
