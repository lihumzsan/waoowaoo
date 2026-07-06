import { describe, expect, it } from 'vitest'
import {
  MUSIC_SCORE_MAX_CUE_DURATION_SECONDS,
  resolveMusicScoreRequestDurationSeconds,
} from '@/lib/music-score/constraints'

describe('music score duration constraints', () => {
  it('uses the fixed clip request for clip models', () => {
    expect(resolveMusicScoreRequestDurationSeconds({
      modelKey: 'google::lyria-3-clip-preview',
      targetDurationSeconds: 22,
    })).toBe(30)
  })

  it('applies Pro minimum and 1.2 safety padding without duration table snapping', () => {
    expect(resolveMusicScoreRequestDurationSeconds({
      modelKey: 'google::lyria-3-pro-preview',
      targetDurationSeconds: 31,
    })).toBe(60)
    expect(resolveMusicScoreRequestDurationSeconds({
      modelKey: 'fal::fal-ai/lyria3/pro',
      targetDurationSeconds: 121,
    })).toBe(146)
  })

  it('fails explicitly when a cue exceeds the reliable Pro duration limit', () => {
    expect(() => resolveMusicScoreRequestDurationSeconds({
      modelKey: 'google::lyria-3-pro-preview',
      targetDurationSeconds: MUSIC_SCORE_MAX_CUE_DURATION_SECONDS + 0.01,
    })).toThrow('MUSIC_SCORE_CUE_DURATION_EXCEEDS_LIMIT')
  })
})
