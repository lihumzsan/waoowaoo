import type { VideoSeamBridgeDurationSeconds } from './seam-bridge'

export type SeamProbeResult = {
  width: number
  height: number
  fps: number
  frameCount: number
  durationSeconds: number
  hasAudio: boolean
  displayRotationDegrees?: Exclude<VideoSeamDisplayRotationDegrees, 0>
}

export type VideoSeamDisplayRotationDegrees = 0 | 90 | 180 | 270

export type VideoSeamAudioPolicy = 'both' | 'video1_only' | 'video2_only' | 'silent'

export const VIDEO_SEAM_FPS_RELATIVE_TOLERANCE = 0.002

export type VideoSeamGenerationCanvas = {
  contentWidth: number
  contentHeight: number
  width: number
  height: number
  padLeft: number
  padTop: number
  padRight: number
  padBottom: number
}

export type VideoSeamBridgePlan = {
  input1: SeamProbeResult
  input2: SeamProbeResult
  outputFps: number
  handleFrames: number
  generatedFrameCount: number
  centralFrameCount: number
  retainedVideo1FrameCount: number
  retainedVideo2FrameCount: number
  outputFrameCount: number
  centralSilenceSeconds: number
  outputDurationSeconds: number
  sourceAnchors: {
    input1Pre: number
    input1Endpoint: number
    input2Endpoint: number
    input2Post: number
  }
  generatedAnchors: [number, number, number, number]
  generationCanvas: VideoSeamGenerationCanvas
  video2AudioTempoFactor: number
  audioPolicy: VideoSeamAudioPolicy
  targetBitrateMbps: number
  requestedDurationSeconds: VideoSeamBridgeDurationSeconds
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const alignUp = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)

function assertProbe(probe: SeamProbeResult): void {
  if (!Number.isInteger(probe.width) || !Number.isInteger(probe.height)
    || probe.width <= 0 || probe.height <= 0 || probe.width % 2 !== 0 || probe.height % 2 !== 0) {
    throw new Error('VIDEO_SEAM_DIMENSIONS_UNSUPPORTED')
  }
  if (!Number.isFinite(probe.fps) || probe.fps <= 0 || !Number.isInteger(probe.frameCount)
    || probe.frameCount <= 0 || !Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) {
    throw new Error('VIDEO_SEAM_MEDIA_PROBE_FAILED')
  }
  if (probe.displayRotationDegrees !== undefined
    && probe.displayRotationDegrees !== 90
    && probe.displayRotationDegrees !== 180
    && probe.displayRotationDegrees !== 270) {
    throw new Error('VIDEO_SEAM_MEDIA_PROBE_FAILED')
  }
}

function resolveCanvas(width: number, height: number): VideoSeamGenerationCanvas {
  const scale = Math.min(1, 1280 / Math.max(width, height))
  const contentWidth = even(width * scale)
  const contentHeight = even(height * scale)
  const canvasWidth = Math.max(64, alignUp(contentWidth, 32))
  const canvasHeight = Math.max(64, alignUp(contentHeight, 32))
  const horizontal = canvasWidth - contentWidth
  const vertical = canvasHeight - contentHeight
  const padLeft = Math.floor(horizontal / 2)
  const padTop = Math.floor(vertical / 2)
  return {
    contentWidth, contentHeight, width: canvasWidth, height: canvasHeight,
    padLeft, padTop, padRight: horizontal - padLeft, padBottom: vertical - padTop,
  }
}

export function buildVideoSeamBridgePlan(input: {
  input1: SeamProbeResult
  input2: SeamProbeResult
  trimEndFrames: number
  trimStartFrames: number
  durationSeconds: VideoSeamBridgeDurationSeconds
}): VideoSeamBridgePlan {
  assertProbe(input.input1)
  assertProbe(input.input2)
  const aspect1 = input.input1.width / input.input1.height
  const aspect2 = input.input2.width / input.input2.height
  if (Math.abs(aspect2 - aspect1) / aspect1 > 0.01) throw new Error('VIDEO_SEAM_ASPECT_RATIO_MISMATCH')
  if (Math.abs(input.input2.fps - input.input1.fps) / input.input1.fps
    > VIDEO_SEAM_FPS_RELATIVE_TOLERANCE) {
    throw new Error('VIDEO_SEAM_FPS_MISMATCH')
  }

  const outputFps = input.input1.fps
  const handleFrames = clamp(Math.round(outputFps * 0.25), 2, 8)
  const input1Endpoint = input.input1.frameCount - input.trimEndFrames - 1
  const input2Endpoint = input.trimStartFrames
  const input1Pre = input1Endpoint - handleFrames
  const input2Post = input2Endpoint + handleFrames
  if (input1Pre < 0 || input2Post >= input.input2.frameCount) {
    throw new Error('VIDEO_SEAM_CONTEXT_TOO_SHORT')
  }

  const generatedFrameCount = 1 + 8 * Math.round((input.durationSeconds * outputFps) / 8)
  if (generatedFrameCount < 2 * handleFrames + 3) throw new Error('VIDEO_SEAM_GENERATED_RANGE_INVALID')
  const generatedAnchors: [number, number, number, number] = [
    0, handleFrames, generatedFrameCount - handleFrames - 1, generatedFrameCount - 1,
  ]
  const centralFrameCount = generatedFrameCount - 2 * handleFrames - 2
  const retainedVideo1FrameCount = input1Endpoint + 1
  const retainedVideo2FrameCount = input.input2.frameCount - input2Endpoint
  const outputFrameCount = retainedVideo1FrameCount + centralFrameCount + retainedVideo2FrameCount
  const targetBitrateMbps = clamp(Math.ceil(
    input.input1.width * input.input1.height * outputFps * 0.07 / 1_000_000,
  ), 10, 40)
  const audioPolicy: VideoSeamAudioPolicy = input.input1.hasAudio
    ? input.input2.hasAudio ? 'both' : 'video1_only'
    : input.input2.hasAudio ? 'video2_only' : 'silent'

  return {
    input1: input.input1, input2: input.input2, outputFps, handleFrames, generatedFrameCount,
    centralFrameCount, retainedVideo1FrameCount, retainedVideo2FrameCount, outputFrameCount,
    centralSilenceSeconds: centralFrameCount / outputFps,
    outputDurationSeconds: outputFrameCount / outputFps,
    sourceAnchors: { input1Pre, input1Endpoint, input2Endpoint, input2Post },
    generatedAnchors, generationCanvas: resolveCanvas(input.input1.width, input.input1.height),
    video2AudioTempoFactor: outputFps / input.input2.fps,
    audioPolicy, targetBitrateMbps, requestedDurationSeconds: input.durationSeconds,
  }
}
