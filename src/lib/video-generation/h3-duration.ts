export const H3_DURATION_OPTIONS_SECONDS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const
export const H3_DURATION_MIN_SECONDS = H3_DURATION_OPTIONS_SECONDS[0]
export const H3_DURATION_MAX_SECONDS = H3_DURATION_OPTIONS_SECONDS.at(-1)!

const H3_FRAMES_PER_SECOND = 24
const H3_FRAME_GRID = 17
const H3_FRAME_REMAINDER = 5
const H3_MIN_FRAMES = 107

export type H3DurationPlan = {
  readonly requestedDurationSeconds: number
  readonly frameCount: number
  readonly promptEndSeconds: number
}

export function resolveH3DurationPlan(requestedDurationSeconds: number): H3DurationPlan {
  if (
    !Number.isInteger(requestedDurationSeconds)
    || requestedDurationSeconds < H3_DURATION_MIN_SECONDS
    || requestedDurationSeconds > H3_DURATION_MAX_SECONDS
  ) {
    throw new Error(`H3_REQUESTED_DURATION_INVALID:${String(requestedDurationSeconds)}`)
  }
  const minimumFrames = Math.max(
    H3_MIN_FRAMES,
    Math.round(requestedDurationSeconds * H3_FRAMES_PER_SECOND),
  )
  const framesUntilNextGrid = (
    H3_FRAME_REMAINDER
    - (minimumFrames % H3_FRAME_GRID)
    + H3_FRAME_GRID
  ) % H3_FRAME_GRID
  const frameCount = minimumFrames + framesUntilNextGrid
  return {
    requestedDurationSeconds,
    frameCount,
    promptEndSeconds: Number((frameCount / H3_FRAMES_PER_SECOND).toFixed(3)),
  }
}
