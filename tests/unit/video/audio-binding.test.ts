import { describe, expect, it } from 'vitest'
import {
  COMFYUI_LTX23_DEFAULT_FPS,
  COMFYUI_LTX23_MAX_DURATION_SECONDS,
  getVideoTimingProfile,
  normalizeVideoDurationBinding,
  parseVideoDurationBinding,
  resolveAudioDrivenVideoTiming,
} from '@/lib/video-duration/audio-binding'

describe('video audio duration binding', () => {
  it('normalizes unknown values to manual mode', () => {
    expect(normalizeVideoDurationBinding(null)).toEqual({
      mode: 'manual',
      voiceLineIds: [],
    })
  })

  it('parses serialized binding payloads', () => {
    expect(parseVideoDurationBinding('{"mode":"match_audio","voiceLineIds":["a","b","a"],"targetDurationSeconds":6}')).toEqual({
      mode: 'match_audio',
      voiceLineIds: ['a', 'b'],
      targetDurationSeconds: 6,
    })
  })

  it('normalizes smart duration metadata without dropping legacy fields', () => {
    expect(normalizeVideoDurationBinding({
      mode: 'manual',
      voiceLineIds: ['a', 'a', ''],
      targetDurationSeconds: 8,
      durationSource: 'smart',
      recommendationConfidence: 0.82,
      recommendationReason: '包含转身和位置移动',
      recommendationFingerprint: 'fp-1',
      recommendationAlgorithmVersion: 'v1',
    })).toEqual({
      mode: 'manual',
      voiceLineIds: ['a'],
      targetDurationSeconds: 8,
      durationSource: 'smart',
      recommendationConfidence: 0.82,
      recommendationReason: '包含转身和位置移动',
      recommendationFingerprint: 'fp-1',
      recommendationAlgorithmVersion: 'v1',
    })
  })

  it('treats legacy manual target as manual source', () => {
    expect(normalizeVideoDurationBinding({
      mode: 'manual',
      targetDurationSeconds: 6,
    })).toMatchObject({
      mode: 'manual',
      targetDurationSeconds: 6,
      durationSource: 'manual',
    })
  })

  it('does not invent manual source for empty legacy manual binding', () => {
    expect(normalizeVideoDurationBinding({ mode: 'manual' })).toEqual({
      mode: 'manual',
      voiceLineIds: [],
    })
  })

  it('defaults linked audio duration to the exact audio duration', () => {
    const timing = resolveAudioDrivenVideoTiming({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1', 'line-2'],
      },
      candidates: [
        { id: 'line-1', audioDuration: 1200 },
        { id: 'line-2', audioDuration: 2800 },
      ],
      modelKey: 'comfyui::basevideo/demo/Wan2.2Remix',
      context: {
        shotType: 'close-up',
        cameraMove: 'slow push-in',
        description: 'doctor pauses, then speaks with a serious expression',
      },
    })

    expect(timing).not.toBeNull()
    expect(timing?.sourceDurationMs).toBe(4000)
    expect(timing?.audioDurationSeconds).toBe(4)
    expect(timing?.targetDurationSeconds).toBe(4)
    expect(timing?.targetFrameCount).toBe(100)
    expect(timing?.preRollSeconds).toBe(0)
    expect(timing?.postRollSeconds).toBe(0)
    expect(timing?.dialogueStartSeconds).toBe(timing?.preRollSeconds)
    expect(timing?.dialogueEndSeconds).toBeCloseTo((timing?.preRollSeconds ?? 0) + 4, 2)
    expect(timing?.timingStrategy).toBe('context_aware_audio')
    expect(timing?.capped).toBe(false)
    expect(timing?.canGenerate).toBe(true)
  })

  it('uses an explicit longer target duration for pre-roll and post-roll', () => {
    const timing = resolveAudioDrivenVideoTiming({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1'],
        targetDurationSeconds: 6,
      },
      candidates: [
        { id: 'line-1', audioDuration: 4000 },
      ],
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      context: {
        shotType: 'close-up',
        cameraMove: 'slow push-in',
        description: 'doctor pauses, then speaks with a serious expression',
      },
    })

    expect(timing).not.toBeNull()
    expect(timing?.audioDurationSeconds).toBe(4)
    expect(timing?.targetDurationSeconds).toBe(6)
    expect(timing?.targetFrameCount).toBe(150)
    expect(timing?.preRollSeconds).toBeGreaterThan(0)
    expect(timing?.postRollSeconds).toBeGreaterThan(0)
    expect(timing?.canGenerate).toBe(true)
  })

  it('blocks ltx2.3 timing when linked audio exceeds the product max duration', () => {
    const timing = resolveAudioDrivenVideoTiming({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1', 'line-2'],
      },
      candidates: [
        { id: 'line-1', audioDuration: 9000 },
        { id: 'line-2', audioDuration: 3500 },
      ],
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
    })

    expect(timing).not.toBeNull()
    expect(timing?.fps).toBe(COMFYUI_LTX23_DEFAULT_FPS)
    expect(timing?.maxDurationSeconds).toBe(12)
    expect(timing?.targetDurationSeconds).toBe(12)
    expect(timing?.targetFrameCount).toBe(COMFYUI_LTX23_DEFAULT_FPS * COMFYUI_LTX23_MAX_DURATION_SECONDS)
    expect(timing?.capped).toBe(true)
    expect(timing?.canGenerate).toBe(false)
    expect(timing?.blockedReason).toBe('audio_exceeds_max_duration')
  })

  it('uses model duration options before the ltx2.3 fallback max duration', () => {
    const timing = resolveAudioDrivenVideoTiming({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1'],
      },
      candidates: [
        { id: 'line-1', audioDuration: 11_000 },
      ],
      modelKey: 'comfyui::basevideo/firstlast/ltx2.3-firstlast',
      durationOptions: [4, 5, 6],
    })

    expect(timing?.maxDurationSeconds).toBe(6)
    expect(timing?.targetDurationSeconds).toBe(6)
    expect(timing?.targetFrameCount).toBe(COMFYUI_LTX23_DEFAULT_FPS * 6)
    expect(timing?.capped).toBe(true)
    expect(timing?.canGenerate).toBe(false)
    expect(timing?.blockedReason).toBe('audio_exceeds_max_duration')
  })

  it('allows configured 12 second LTX duration options for 11.4 second linked audio', () => {
    const timing = resolveAudioDrivenVideoTiming({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1'],
      },
      candidates: [
        { id: 'line-1', audioDuration: 11_400 },
      ],
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      durationOptions: [2, 4, 6, 8, 12],
    })

    expect(timing?.maxDurationSeconds).toBe(12)
    expect(timing?.targetDurationSeconds).toBe(11.4)
    expect(timing?.targetFrameCount).toBe(285)
    expect(timing?.canGenerate).toBe(true)
    expect(timing?.blockedReason).toBeUndefined()
  })

  it('uses ltx23 profile max duration instead of the product 12 second cap', () => {
    const timing = getVideoTimingProfile('comfyui::basevideo/ltx23-profiles/damaicha-image-to-30s-long-video')

    expect(timing).toEqual({ fps: 25, maxDurationSeconds: 30 })
  })

  it('blocks overlong linked audio without advertising an unimplemented split flow', () => {
    const timing = resolveAudioDrivenVideoTiming({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1'],
      },
      candidates: [
        {
          id: 'line-1',
          speaker: 'Doctor',
          content: 'This is a deliberately long spoken sentence that should be split automatically.',
          audioDuration: 23_700,
        },
      ],
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      durationOptions: [4, 5, 6, 8, 10, 12],
    })

    expect(timing?.canGenerate).toBe(false)
    expect(timing?.blockedReason).toBe('audio_exceeds_max_duration')
    expect(timing).not.toHaveProperty('splitPlan')
  })
})
