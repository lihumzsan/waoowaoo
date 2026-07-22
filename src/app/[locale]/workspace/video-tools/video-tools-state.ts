import { isValidVideoTrimFrames } from '@/lib/video-tools/trim-frames'
import type {
  SeamProbeResult,
  VideoSeamAudioPolicy,
  VideoSeamGenerationCanvas,
} from '@/lib/video-tools/seam-bridge-plan'

export type UploadedVideo = {
  key: string
  url: string
  name: string
  size: number
  mimeType: string
}

export type VideoToolTask = {
  id: string
  status: string
  progress: number
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: { message?: string | null } | null
}

export type VideoToolTaskPhase =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'probing'
  | 'generating'
  | 'composing'
  | 'processing'
  | 'persisting'
  | 'completed'
  | 'failed'

export type VideoToolTaskView = {
  phase: VideoToolTaskPhase
  active: boolean
  videoUrl: string | null
  videoKey: string | null
  errorMessage: string | null
}

export type VideoSeamDiagnostics = {
  probes: {
    input1: SeamProbeResult
    input2: SeamProbeResult
  }
  output: SeamProbeResult
  bridge: {
    requestedDurationSeconds: 4 | 6 | 8
    handleFrames: number
    generatedFrameCount: number
    centralFrameCount: number
    centralSilenceSeconds: number
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
  }
}

const VIDEO_SEAM_ERROR_KEYS = [
  ['VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED', 'errors.mediaDownloadFailed'],
  ['VIDEO_SEAM_FFMPEG_UNAVAILABLE', 'errors.ffmpegUnavailable'],
  ['VIDEO_SEAM_MEDIA_PROBE_FAILED', 'errors.mediaProbeFailed'],
  ['VIDEO_SEAM_DIMENSIONS_UNSUPPORTED', 'errors.dimensionsUnsupported'],
  ['VIDEO_SEAM_ASPECT_RATIO_MISMATCH', 'errors.aspectRatioMismatch'],
  ['VIDEO_SEAM_FPS_MISMATCH', 'errors.fpsMismatch'],
  ['VIDEO_SEAM_CONTEXT_TOO_SHORT', 'errors.contextTooShort'],
  ['VIDEO_SEAM_ANCHOR_OUTPUT_MISSING', 'errors.anchorMissing'],
  ['VIDEO_SEAM_FOUR_ANCHOR_UNSUPPORTED', 'errors.fourAnchorUnsupported'],
  ['VIDEO_SEAM_GENERATED_RANGE_INVALID', 'errors.generatedRangeInvalid'],
  ['VIDEO_SEAM_AUDIO_COMPOSE_FAILED', 'errors.audioComposeFailed'],
] as const

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && isFiniteNumber(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && isFiniteNumber(value) && value >= 0
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function readFourAnchorTuple(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isNonNegativeInteger)) return null
  return [value[0], value[1], value[2], value[3]]
}

function readGenerationCanvas(value: unknown): VideoSeamGenerationCanvas | null {
  if (!isRecord(value)
    || !isPositiveInteger(value.contentWidth)
    || !isPositiveInteger(value.contentHeight)
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || !isNonNegativeInteger(value.padLeft)
    || !isNonNegativeInteger(value.padTop)
    || !isNonNegativeInteger(value.padRight)
    || !isNonNegativeInteger(value.padBottom)) return null
  return {
    contentWidth: value.contentWidth,
    contentHeight: value.contentHeight,
    width: value.width,
    height: value.height,
    padLeft: value.padLeft,
    padTop: value.padTop,
    padRight: value.padRight,
    padBottom: value.padBottom,
  }
}

function readProbe(value: unknown): SeamProbeResult | null {
  if (!isRecord(value)
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || !isFiniteNumber(value.fps) || value.fps <= 0
    || !isPositiveInteger(value.frameCount)
    || !isFiniteNumber(value.durationSeconds) || value.durationSeconds <= 0
    || !isBoolean(value.hasAudio)) return null
  return {
    width: value.width,
    height: value.height,
    fps: value.fps,
    frameCount: value.frameCount,
    durationSeconds: value.durationSeconds,
    hasAudio: value.hasAudio,
  }
}

function readSourceAnchors(value: unknown): VideoSeamDiagnostics['bridge']['sourceAnchors'] | null {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.input1Pre)
    || !isNonNegativeInteger(value.input1Endpoint)
    || !isNonNegativeInteger(value.input2Endpoint)
    || !isNonNegativeInteger(value.input2Post)) return null
  return {
    input1Pre: value.input1Pre,
    input1Endpoint: value.input1Endpoint,
    input2Endpoint: value.input2Endpoint,
    input2Post: value.input2Post,
  }
}

function readAudioPolicy(value: unknown): VideoSeamAudioPolicy | null {
  return value === 'both' || value === 'video1_only' || value === 'video2_only' || value === 'silent'
    ? value
    : null
}

export function resolveVideoSeamDiagnostics(
  result: Record<string, unknown> | null,
): VideoSeamDiagnostics | null {
  if (!result || result.mode !== 'ai_bridge' || !isRecord(result.probes) || !isRecord(result.bridge)) {
    return null
  }
  const input1 = readProbe(result.probes.input1)
  const input2 = readProbe(result.probes.input2)
  const output = readProbe(result.output)
  const sourceAnchors = readSourceAnchors(result.bridge.sourceAnchors)
  const generatedAnchors = readFourAnchorTuple(result.bridge.generatedAnchors)
  const generationCanvas = readGenerationCanvas(result.bridge.generationCanvas)
  const audioPolicy = readAudioPolicy(result.bridge.audioPolicy)
  if (!input1 || !input2 || !output || !sourceAnchors || !generatedAnchors || !generationCanvas
    || !audioPolicy
    || (result.bridge.requestedDurationSeconds !== 4
      && result.bridge.requestedDurationSeconds !== 6
      && result.bridge.requestedDurationSeconds !== 8)
    || !isPositiveInteger(result.bridge.handleFrames)
    || !isPositiveInteger(result.bridge.generatedFrameCount)
    || !isPositiveInteger(result.bridge.centralFrameCount)
    || !isFiniteNumber(result.bridge.centralSilenceSeconds) || result.bridge.centralSilenceSeconds < 0
    || !isFiniteNumber(result.bridge.video2AudioTempoFactor) || result.bridge.video2AudioTempoFactor <= 0
    || !isFiniteNumber(result.bridge.targetBitrateMbps) || result.bridge.targetBitrateMbps <= 0) {
    return null
  }
  return {
    probes: { input1, input2 },
    output,
    bridge: {
      requestedDurationSeconds: result.bridge.requestedDurationSeconds,
      handleFrames: result.bridge.handleFrames,
      generatedFrameCount: result.bridge.generatedFrameCount,
      centralFrameCount: result.bridge.centralFrameCount,
      centralSilenceSeconds: result.bridge.centralSilenceSeconds,
      sourceAnchors,
      generatedAnchors,
      generationCanvas,
      video2AudioTempoFactor: result.bridge.video2AudioTempoFactor,
      audioPolicy,
      targetBitrateMbps: result.bridge.targetBitrateMbps,
    },
  }
}

export function resolveVideoSeamErrorTranslationKey(message: string | null): string {
  const match = VIDEO_SEAM_ERROR_KEYS.find(([code]) => message?.includes(code))
  return match?.[1] || 'errors.processingFailed'
}

function isActiveTask(task: VideoToolTask | null | undefined): boolean {
  return task?.status === 'queued'
    || task?.status === 'processing'
    || (task?.status === 'completed' && !readString(task.result?.videoUrl))
}

export function canSubmitVideoSeamConcat(
  input1: UploadedVideo | null,
  input2: UploadedVideo | null,
  currentTask: VideoToolTask | null,
  input1TrimEndFrames: unknown = 0,
  input2TrimStartFrames: unknown = 1,
): boolean {
  return !!input1
    && !!input2
    && isValidVideoTrimFrames(input1TrimEndFrames)
    && isValidVideoTrimFrames(input2TrimStartFrames)
    && !isActiveTask(currentTask)
}

export function resolveVideoToolTaskView(task: VideoToolTask | null): VideoToolTaskView {
  if (!task) {
    return { phase: 'idle', active: false, videoUrl: null, videoKey: null, errorMessage: null }
  }

  const videoUrl = readString(task.result?.videoUrl)
  const videoKey = readString(task.result?.videoKey)
  if (task.status === 'completed') {
    if (!videoUrl) {
      return { phase: 'persisting', active: true, videoUrl: null, videoKey: null, errorMessage: null }
    }
    return { phase: 'completed', active: false, videoUrl, videoKey, errorMessage: null }
  }
  if (task.status === 'failed' || task.status === 'canceled') {
    return {
      phase: 'failed',
      active: false,
      videoUrl: null,
      videoKey: null,
      errorMessage: readString(task.error?.message) || 'VIDEO_SEAM_CONCAT_FAILED',
    }
  }
  if (task.status === 'queued') {
    return { phase: 'queued', active: true, videoUrl: null, videoKey: null, errorMessage: null }
  }

  const stage = readString(task.payload?.stage)
  const phase: VideoToolTaskPhase = stage === 'persist_output'
    ? 'persisting'
    : stage === 'prepare_inputs'
      ? 'preparing'
      : stage === 'probe_media' || stage === 'extract_anchors'
        ? 'probing'
        : stage === 'generate_bridge'
          ? 'generating'
          : stage === 'compose_output'
            ? 'composing'
            : 'processing'
  return { phase, active: true, videoUrl: null, videoKey: null, errorMessage: null }
}

export function resolvePersistedVideoSeamTaskId(task: VideoToolTask | null): string | null {
  return resolveVideoToolTaskView(task).active ? task?.id || null : null
}
