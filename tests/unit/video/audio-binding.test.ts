import { describe, expect, it } from 'vitest'
import {
  COMFYUI_LTX23_DEFAULT_FPS,
  COMFYUI_LTX23_MAX_DURATION_SECONDS,
  normalizeVideoDurationBinding,
  parseVideoDurationBinding,
  resolveAudioDrivenVideoSplitPlan,
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

  it('builds a split plan when linked audio exceeds the workflow max duration', () => {
    const plan = resolveAudioDrivenVideoSplitPlan({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1'],
      },
      candidates: [
        {
          id: 'line-1',
          speaker: 'Doctor',
          content: 'We need to review the symptoms carefully, then decide whether this treatment can continue.',
          audioDuration: 23_700,
        },
      ],
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      durationOptions: [4, 5, 6, 8, 10, 12],
    })

    expect(plan).not.toBeNull()
    expect(plan?.segments).toHaveLength(2)
    expect(plan?.totalAudioDurationSeconds).toBe(23.7)
    expect(plan?.segments.every((segment) => segment.targetDurationSeconds <= 12)).toBe(true)
    expect(plan?.segments.map((segment) => segment.targetFrameCount)).toEqual([296, 296])
    expect(plan?.segments[0]?.voiceLines[0]?.content).not.toEqual(plan?.segments[1]?.voiceLines[0]?.content)
  })

  it('prefers voice-line boundaries when splitting multiple linked lines', () => {
    const plan = resolveAudioDrivenVideoSplitPlan({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['a', 'b', 'c'],
      },
      candidates: [
        { id: 'a', speaker: 'A', content: 'first line', audioDuration: 7_000 },
        { id: 'b', speaker: 'B', content: 'second line', audioDuration: 4_500 },
        { id: 'c', speaker: 'A', content: 'third line', audioDuration: 8_000 },
      ],
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      durationOptions: [4, 6, 8, 12],
    })

    expect(plan?.segments).toHaveLength(2)
    expect(plan?.segments[0]?.voiceLineIds).toEqual(['a', 'b'])
    expect(plan?.segments[1]?.voiceLineIds).toEqual(['c'])
    expect(plan?.segments[0]?.audioDurationSeconds).toBe(11.5)
    expect(plan?.segments[1]?.audioDurationSeconds).toBe(8)
  })

  it('attaches a split plan to blocked timing so callers can allow automatic generation', () => {
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
    expect(timing?.splitPlan?.segments).toHaveLength(2)
  })
})
