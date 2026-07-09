import { describe, expect, it } from 'vitest'
import {
  MUSIC_SCORE_MAX_CUE_DURATION_SECONDS,
  resolveMusicScoreMaxCueDurationSeconds,
  resolveMusicScoreRequestDurationSeconds,
} from '@/lib/music-score/constraints'

describe('music score duration constraints', () => {
  it('uses one Pro cue duration limit for BGM score windows', () => {
    expect(resolveMusicScoreMaxCueDurationSeconds()).toBe(180)
    expect(MUSIC_SCORE_MAX_CUE_DURATION_SECONDS).toBe(180)
  })

  it('applies Pro minimum and 1.2 safety padding without duration table snapping', () => {
    expect(resolveMusicScoreRequestDurationSeconds({
      targetDurationSeconds: 31,
    })).toBe(60)
    expect(resolveMusicScoreRequestDurationSeconds({
      targetDurationSeconds: 121,
    })).toBe(146)
  })

  it('caps provider requests at the Pro request limit while allowing 180-second cue windows', () => {
    expect(resolveMusicScoreRequestDurationSeconds({
      targetDurationSeconds: 180,
    })).toBe(180)
  })

  it('fails explicitly when a cue exceeds the reliable Pro duration limit', () => {
    expect(() => resolveMusicScoreRequestDurationSeconds({
      targetDurationSeconds: MUSIC_SCORE_MAX_CUE_DURATION_SECONDS + 0.01,
    })).toThrow('MUSIC_SCORE_CUE_DURATION_EXCEEDS_LIMIT')
  })
})
