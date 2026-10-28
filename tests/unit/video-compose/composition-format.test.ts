import { describe, expect, it } from 'vitest'
import { ASPECT_RATIO_CONFIGS, VIDEO_RESOLUTIONS } from '@/lib/constants'
import { resolveProjectVideoCanvas } from '@/lib/operations/project-video-ratio-policy'

describe('composition canvas geometry', () => {
  it('uses project orientation and short-edge resolution independently of source geometry', () => {
    expect(
      resolveProjectVideoCanvas({ aspectRatio: '9:16', resolution: '720p' }),
    ).toEqual({
      width: 720,
      height: 1280,
      aspectRatio: '9:16',
      resolution: '720p',
    })
  })
  it('preserves every declared ratio within one encoded pixel with even dimensions', () => {
    for (const aspectRatio of Object.keys(ASPECT_RATIO_CONFIGS))
      for (const { value: resolution } of VIDEO_RESOLUTIONS) {
        const canvas = resolveProjectVideoCanvas({ aspectRatio, resolution })
        const [rw, rh] = aspectRatio.split(':').map(Number)
        expect(Math.min(canvas.width, canvas.height)).toBe(
          Number.parseInt(resolution, 10),
        )
        expect(
          Math.abs(canvas.width / canvas.height - rw! / rh!),
        ).toBeLessThanOrEqual(1 / canvas.height)
        expect(canvas.width % 2).toBe(0)
        expect(canvas.height % 2).toBe(0)
      }
  })
})
