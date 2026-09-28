import type { VideoInputMode } from '@/lib/ai-registry/types'
import { H3_CONTINUATION_GUIDE_FRAMES, H3_FRAMES_PER_SECOND } from './h3-timeline'
import { listH3DurationOptions } from './h3-runtime-policy'

const H3_FRAME_GRID = 17
const H3_FRAME_REMAINDER = 5
const H3_MIN_FRAMES = 107

export type H3DurationPlan = {
  readonly requestedDurationSeconds: number
  readonly frameCount: number
  readonly promptStartSeconds: number
  readonly promptEndSeconds: number
  readonly expectedOutputDurationSeconds: number
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
    promptStartSeconds: Number((leadingGuideFrames / H3_FRAMES_PER_SECOND).toFixed(3)),
    expectedOutputDurationSeconds: Number(((frameCount - leadingGuideFrames) / H3_FRAMES_PER_SECOND).toFixed(3)),
    promptEndSeconds: Number((frameCount / H3_FRAMES_PER_SECOND).toFixed(3)),
  }
}

export function resolveH3DurationPlan(input: {
  readonly inputMode: VideoInputMode
  readonly requestedDurationSeconds: number
}): H3DurationPlan {
  if (input.inputMode === 'text_to_video') {
    throw new Error(`H3_INPUT_MODE_INVALID:${input.inputMode}`)
  }
  if (!Number.isInteger(input.requestedDurationSeconds) || !listH3DurationOptions(input.inputMode).includes(input.requestedDurationSeconds)) {
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
      Math.max(...listH3DurationOptions('continuation')),
      H3_CONTINUATION_GUIDE_FRAMES,
    ).frameCount
    - H3_CONTINUATION_GUIDE_FRAMES
    + 1
  ) / H3_FRAMES_PER_SECOND * 1_000,
)
