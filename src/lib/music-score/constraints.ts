export const MUSIC_SCORE_PROVIDER_DURATION_SAFETY_MULTIPLIER = 1.2
export const MUSIC_SCORE_PRO_MIN_REQUEST_SECONDS = 60
export const MUSIC_SCORE_PRO_MAX_REQUEST_SECONDS = 180
export const MUSIC_SCORE_MAX_CUE_DURATION_SECONDS = MUSIC_SCORE_PRO_MAX_REQUEST_SECONDS

function assertPositiveFiniteSeconds(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('MUSIC_SCORE_CUE_DURATION_INVALID')
  }
}

export function resolveMusicScoreMaxCueDurationSeconds(): number {
  return MUSIC_SCORE_MAX_CUE_DURATION_SECONDS
}

export function resolveMusicScoreRequestDurationSeconds(input: {
  readonly targetDurationSeconds: number
}): number {
  assertPositiveFiniteSeconds(input.targetDurationSeconds)
  if (input.targetDurationSeconds > MUSIC_SCORE_MAX_CUE_DURATION_SECONDS) {
    throw new Error(`MUSIC_SCORE_CUE_DURATION_EXCEEDS_LIMIT:${input.targetDurationSeconds.toFixed(3)}:${MUSIC_SCORE_MAX_CUE_DURATION_SECONDS.toFixed(3)}`)
  }
  return Math.min(
    MUSIC_SCORE_PRO_MAX_REQUEST_SECONDS,
    Math.max(
      MUSIC_SCORE_PRO_MIN_REQUEST_SECONDS,
      Math.ceil(input.targetDurationSeconds * MUSIC_SCORE_PROVIDER_DURATION_SAFETY_MULTIPLIER),
    ),
  )
}
