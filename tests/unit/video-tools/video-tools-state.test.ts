import { describe, expect, it } from 'vitest'
import {
  canSubmitVideoSeamConcat,
  resolveVideoSeamDiagnostics,
  resolveVideoSeamErrorTranslationKey,
  resolvePersistedVideoSeamTaskId,
  resolveVideoToolTaskView,
  type UploadedVideo,
  type VideoToolTask,
} from '@/app/[locale]/workspace/video-tools/video-tools-state'

const upload: UploadedVideo = {
  key: 'video-tools/user-1/inputs/one.mp4',
  url: '/api/storage/sign?key=one',
  name: 'one.mp4',
  size: 100,
  mimeType: 'video/mp4',
}

const aiBridgeResult = {
  videoKey: 'video-tools/user-1/outputs/result.mp4',
  videoUrl: '/api/storage/sign?key=result',
  mimeType: 'video/mp4',
  mode: 'ai_bridge',
  input1Name: 'one.mp4',
  input1TrimEndFrames: 0,
  input2Name: 'two.mp4',
  input2TrimStartFrames: 1,
  probes: {
    input1: {
      width: 1920,
      height: 1080,
      fps: 24,
      frameCount: 240,
      durationSeconds: 10,
      hasAudio: true,
    },
    input2: {
      width: 1920,
      height: 1080,
      fps: 24,
      frameCount: 288,
      durationSeconds: 12,
      hasAudio: true,
    },
  },
  output: {
    width: 1920,
    height: 1080,
    fps: 24,
    frameCount: 610,
    durationSeconds: 610 / 24,
    hasAudio: true,
  },
  bridge: {
    requestedDurationSeconds: 4,
    handleFrames: 6,
    generatedFrameCount: 97,
    generationCanvas: {
      contentWidth: 1280,
      contentHeight: 720,
      width: 1280,
      height: 736,
      padLeft: 0,
      padTop: 8,
      padRight: 0,
      padBottom: 8,
    },
    sourceAnchors: {
      input1Pre: 233,
      input1Endpoint: 239,
      input2Endpoint: 1,
      input2Post: 7,
    },
    generatedAnchors: [0, 6, 90, 96],
    centralFrameCount: 83,
    centralSilenceSeconds: 83 / 24,
    video2AudioTempoFactor: 1,
    audioPolicy: 'both',
    targetBitrateMbps: 10,
  },
}

function task(overrides: Partial<VideoToolTask>): VideoToolTask {
  return {
    id: 'task-1',
    status: 'queued',
    progress: 0,
    payload: {},
    result: null,
    error: null,
    ...overrides,
  }
}

describe('video tools state', () => {
  it('enables submission only when both uploads exist and no task is active', () => {
    expect(canSubmitVideoSeamConcat(upload, upload, null)).toBe(true)
    expect(canSubmitVideoSeamConcat(upload, null, null)).toBe(false)
    expect(canSubmitVideoSeamConcat(upload, upload, task({ status: 'processing' }))).toBe(false)
    expect(canSubmitVideoSeamConcat(upload, upload, task({ status: 'completed', result: null }))).toBe(false)
    expect(canSubmitVideoSeamConcat(upload, upload, task({
      status: 'completed',
      result: { videoKey: 'output.mp4', videoUrl: '/api/storage/sign?key=output' },
    }))).toBe(true)
  })

  it('rejects seam-concat submission when either trim is invalid', () => {
    expect(canSubmitVideoSeamConcat(upload, upload, null, 0, 1)).toBe(true)
    expect(canSubmitVideoSeamConcat(upload, upload, null, 0.5, 1)).toBe(false)
    expect(canSubmitVideoSeamConcat(upload, upload, null, 0, -1)).toBe(false)
  })

  it('maps queued, processing, failed, and completed tasks to truthful views', () => {
    expect(resolveVideoToolTaskView(task({ status: 'queued' }))).toMatchObject({ phase: 'queued', active: true })
    expect(resolveVideoToolTaskView(task({ status: 'processing', payload: { stage: 'persist_output' } })))
      .toMatchObject({ phase: 'persisting', active: true })
    expect(resolveVideoToolTaskView(task({
      status: 'failed',
      error: { message: 'ComfyUI failed' },
    }))).toMatchObject({ phase: 'failed', active: false, errorMessage: 'ComfyUI failed' })
    expect(resolveVideoToolTaskView(task({ status: 'completed', result: null })))
      .toMatchObject({ phase: 'persisting', active: true, videoUrl: null })
    expect(resolveVideoToolTaskView(task({
      status: 'completed',
      result: { videoKey: 'output.mp4', videoUrl: '/api/storage/sign?key=output' },
    }))).toMatchObject({
      phase: 'completed',
      active: false,
      videoUrl: '/api/storage/sign?key=output',
    })
  })

  it('persists only recoverable active task ids', () => {
    expect(resolvePersistedVideoSeamTaskId(task({ status: 'queued' }))).toBe('task-1')
    expect(resolvePersistedVideoSeamTaskId(task({ status: 'processing' }))).toBe('task-1')
    expect(resolvePersistedVideoSeamTaskId(task({ status: 'failed' }))).toBeNull()
    expect(resolvePersistedVideoSeamTaskId(task({
      status: 'completed',
      result: { videoUrl: '/output.mp4' },
    }))).toBeNull()
  })

  it.each([
    ['probe_media', 'probing'],
    ['extract_anchors', 'probing'],
    ['generate_bridge', 'generating'],
    ['compose_output', 'composing'],
    ['persist_output', 'persisting'],
    ['prepare_inputs', 'preparing'],
  ])('maps %s to the truthful %s phase', (stage, phase) => {
    expect(resolveVideoToolTaskView(task({ status: 'processing', payload: { stage } })))
      .toMatchObject({ phase, active: true })
  })

  it.each([
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
  ])('maps %s to %s', (code, key) => {
    expect(resolveVideoSeamErrorTranslationKey(`worker failed: ${code}`)).toBe(key)
  })

  it('hides unknown provider errors behind a stable processing failure message', () => {
    expect(resolveVideoSeamErrorTranslationKey('provider socket closed'))
      .toBe('errors.processingFailed')
  })

  it('validates every nested AI bridge diagnostic value', () => {
    expect(resolveVideoSeamDiagnostics(aiBridgeResult)).toEqual({
      probes: aiBridgeResult.probes,
      output: aiBridgeResult.output,
      bridge: aiBridgeResult.bridge,
    })
  })

  it.each([
    ['direct mode', { ...aiBridgeResult, mode: 'direct' }],
    ['missing generation canvas', {
      ...aiBridgeResult,
      bridge: { ...aiBridgeResult.bridge, generationCanvas: undefined },
    }],
    ['non-finite FPS', {
      ...aiBridgeResult,
      output: { ...aiBridgeResult.output, fps: Number.POSITIVE_INFINITY },
    }],
    ['three generated anchors', {
      ...aiBridgeResult,
      bridge: { ...aiBridgeResult.bridge, generatedAnchors: [0, 6, 90] },
    }],
    ['unknown audio policy', {
      ...aiBridgeResult,
      bridge: { ...aiBridgeResult.bridge, audioPolicy: 'crossfade' },
    }],
  ])('rejects diagnostics with %s', (_case, result) => {
    expect(resolveVideoSeamDiagnostics(result)).toBeNull()
  })

})
