import { describe, expect, it } from 'vitest'
import {
  applyRecommendedVideoDurationSelection,
  normalizeRecommendedVideoDuration,
  withRecommendedVideoDuration,
} from '@/lib/model-capabilities/video-recommended-duration'

const definitions = [{ field: 'duration', options: [5, 10], fieldI18n: null }]
const bernini = 'comfyui::basevideo/seedance2/bernini-480p-i2v'

describe('video recommended duration', () => {
  it('prepends a valid card duration and removes duplicates', () => {
    expect(withRecommendedVideoDuration(definitions, {
      modelKey: bernini,
      recommendedDuration: 9,
    })[0].options).toEqual([9, 5, 10])

    expect(withRecommendedVideoDuration(definitions, {
      modelKey: bernini,
      recommendedDuration: 10,
    })[0].options).toEqual([10, 5])
  })

  it.each([undefined, null, '', 0, -2, 'nope'])(
    'preserves current options for invalid recommendation %s',
    (value) => {
      expect(withRecommendedVideoDuration(definitions, {
        modelKey: bernini,
        recommendedDuration: value,
      })).toEqual(definitions)
    },
  )

  it('does not add custom seconds to a non-Bernini workflow', () => {
    expect(withRecommendedVideoDuration(definitions, {
      modelKey: 'comfyui::other',
      recommendedDuration: 9,
    })).toEqual(definitions)
  })

  it('normalizes numeric strings and rejects non-positive values', () => {
    expect(normalizeRecommendedVideoDuration('9')).toBe(9)
    expect(normalizeRecommendedVideoDuration(0)).toBeNull()
  })

  it('replaces only the default duration selection for Bernini', () => {
    expect(applyRecommendedVideoDurationSelection(
      { duration: 5, motionStrength: 2 },
      { modelKey: bernini, recommendedDuration: 9 },
    )).toEqual({ duration: 9, motionStrength: 2 })
    expect(applyRecommendedVideoDurationSelection(
      { duration: 5, motionStrength: 2 },
      { modelKey: bernini, recommendedDuration: undefined },
    )).toEqual({ duration: 5, motionStrength: 2 })
  })
})
