import type { VideoInputMode } from '@/lib/ai-registry/types'
import { H3_CONTINUATION_GUIDE_FRAMES, H3_FRAMES_PER_SECOND, H3_MAX_SEGMENT_DURATION_SECONDS } from './h3-timeline'

export const H3_DURATION_OPTIONS_SECONDS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, H3_MAX_SEGMENT_DURATION_SECONDS,
] as const

const H3_FRAME_GRID = 17
const H3_FRAME_REMAINDER = 5
const H3_MIN_FRAMES = 107

export type H3DurationPlan = {
  readonly requestedDurationSeconds: number
  readonly frameCount: number
  readonly promptEndSeconds: number
}

function resolveAlignedPlan(requestedDurationSeconds: number, leadingGuideFrames: number): H3DurationPlan {
  const minimumFrames = Math.max(
    H3_MIN_FRAMES,
    Math.round(requestedDurationSeconds * H3_FRAMES_PER_SECOND) + leadingGuideFrames,
  )
  const framesUntilNextGrid = (H3_FRAME_REMAINDER - (minimumFrames % H3_FRAME_GRID) + H3_FRAME_GRID) % H3_FRAME_GRID
  const frameCount = minimumFrames + framesUntilNextGrid
  return {
    requestedDurationSeconds,
    frameCount,
    promptEndSeconds: Number((frameCount / H3_FRAMES_PER_SECOND).toFixed(3)),
  }
}

export function resolveH3DurationPlan(input: {
  readonly inputMode: VideoInputMode
  readonly requestedDurationSeconds: number
}): H3DurationPlan {
  if (!Number.isInteger(input.requestedDurationSeconds) || !H3_DURATION_OPTIONS_SECONDS.includes(
    input.requestedDurationSeconds as typeof H3_DURATION_OPTIONS_SECONDS[number],
  )) {
    throw new Error(`H3_REQUESTED_DURATION_INVALID:${input.inputMode}:${String(input.requestedDurationSeconds)}`)
  }
  return resolveAlignedPlan(
    input.requestedDurationSeconds,
    input.inputMode === 'continuation' ? H3_CONTINUATION_GUIDE_FRAMES : 0,
  )
}

export const H3_CONTINUATION_MAX_SOURCE_DURATION_MS = Math.floor(
  (
    resolveAlignedPlan(
      H3_MAX_SEGMENT_DURATION_SECONDS,
      H3_CONTINUATION_GUIDE_FRAMES,
    ).frameCount
    - H3_CONTINUATION_GUIDE_FRAMES
    + 1
  ) / H3_FRAMES_PER_SECOND * 1_000,
)
