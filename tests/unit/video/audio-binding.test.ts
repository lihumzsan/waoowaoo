import { describe, expect, it } from 'vitest'
import {
  COMFYUI_LTX23_DEFAULT_FPS,
  COMFYUI_LTX23_MAX_DURATION_SECONDS,
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
    expect(parseVideoDurationBinding('{"mode":"match_audio","voiceLineIds":["a","b","a"]}')).toEqual({
      mode: 'match_audio',
      voiceLineIds: ['a', 'b'],
    })
  })

  it('sums selected audio durations for regular models', () => {
    const timing = resolveAudioDrivenVideoTiming({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1', 'line-2'],
      },
      candidates: [
        { id: 'line-1', audioDuration: 1200 },
        { id: 'line-2', audioDuration: 2800 },
      ],
      modelKey: 'comfyui::basevideo/图生视频/Wan2.2Remix图生视频',
    })

    expect(timing).not.toBeNull()
    expect(timing?.sourceDurationMs).toBe(4000)
    expect(timing?.targetDurationSeconds).toBe(4)
    expect(timing?.targetFrameCount).toBe(100)
    expect(timing?.capped).toBe(false)
  })

  it('caps ltx2.3 timing to the safe max duration', () => {
    const timing = resolveAudioDrivenVideoTiming({
      binding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1', 'line-2'],
      },
      candidates: [
        { id: 'line-1', audioDuration: 4200 },
        { id: 'line-2', audioDuration: 3900 },
      ],
      modelKey: 'comfyui::basevideo/图生视频/LTX2.3图生视频快速版',
    })

    expect(timing).not.toBeNull()
    expect(timing?.fps).toBe(COMFYUI_LTX23_DEFAULT_FPS)
    expect(timing?.maxDurationSeconds).toBe(COMFYUI_LTX23_MAX_DURATION_SECONDS)
    expect(timing?.targetDurationSeconds).toBe(COMFYUI_LTX23_MAX_DURATION_SECONDS)
    expect(timing?.targetFrameCount).toBe(COMFYUI_LTX23_DEFAULT_FPS * COMFYUI_LTX23_MAX_DURATION_SECONDS)
    expect(timing?.capped).toBe(true)
  })
})
