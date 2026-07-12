import { describe, expect, it } from 'vitest'
import {
  buildFirstLastFrameSmartDurationFingerprint,
  computeFirstLastFrameSmartDuration,
  parseFirstLastFrameDurationAnalysis,
} from '@/lib/novel-promotion/first-last-frame-smart-duration'

describe('first/last-frame smart duration', () => {
  it('adds serial stages and takes the max duration inside a parallel group', () => {
    const result = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [
          { type: 'body_action', order: 1 },
          { type: 'locomotion', order: 2, parallelGroup: 'move' },
          { type: 'environment_change', order: 2, parallelGroup: 'move' },
          { type: 'camera_standard', order: 2, parallelGroup: 'move' },
        ],
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.9,
        reason: '包含转身和位置移动，镜头缓慢推进',
      },
      fingerprint: 'fingerprint-1',
    })

    expect(result).toMatchObject({
      durationSeconds: 8,
      frameCount: 193,
      fps: 24,
      source: 'smart',
      confidence: 0.9,
    })
  })

  it.each([
    ['fast', 7],
    ['normal', 8],
    ['slow', 9],
  ] as const)('applies %s pacing', (pacing, expectedDuration) => {
    const result = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [
          { type: 'body_action', order: 1 },
          { type: 'locomotion', order: 2 },
        ],
        pacing,
        continuity: 'good',
        confidence: 0.8,
        reason: '动作清晰',
      },
      fingerprint: 'fingerprint-pace',
    })

    expect(result.durationSeconds).toBe(expectedDuration)
  })

  it('never recommends shorter than the audio target', () => {
    const result = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [{ type: 'gesture', order: 1 }],
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.8,
        reason: '轻微手势',
      },
      fingerprint: 'fingerprint-audio',
      audioTargetDurationSeconds: 12,
    })

    expect(result.durationSeconds).toBe(12)
  })

  it.each([
    ['empty motion clamps to min', [], 4],
    ['long serial motion clamps to max', Array.from({ length: 8 }, (_, index) => ({ type: 'transformation' as const, order: index + 1 })), 15],
  ])('%s', (_label, motionBeats, expectedDuration) => {
    const result = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats,
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.95,
        reason: '测试边界',
      },
      fingerprint: 'fingerprint-boundary',
    })

    expect(result.durationSeconds).toBe(expectedDuration)
  })

  it('falls back to 10s for low confidence and discontinuous continuity', () => {
    const lowConfidence = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [{ type: 'locomotion', order: 1 }],
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.59,
        reason: '置信度不足',
      },
      fingerprint: 'low-confidence',
    })
    const discontinuous = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [{ type: 'locomotion', order: 1 }],
        pacing: 'normal',
        continuity: 'discontinuous',
        confidence: 0.9,
        reason: '首尾画面变化较大，建议增加中间关键帧',
      },
      fingerprint: 'discontinuous',
    })

    expect(lowConfidence).toMatchObject({ durationSeconds: 10, source: 'fallback', fallbackReason: 'low_confidence' })
    expect(discontinuous).toMatchObject({ durationSeconds: 10, source: 'fallback', fallbackReason: 'discontinuous' })
  })

  it('rejects invalid structured analysis', () => {
    expect(parseFirstLastFrameDurationAnalysis({
      motion_beats: [{ type: 'unknown', order: 1 }],
      pacing: 'normal',
      continuity: 'good',
      confidence: 0.9,
      reason: 'invalid',
    })).toBeNull()
    expect(parseFirstLastFrameDurationAnalysis({
      motion_beats: [{ type: 'gesture', order: 1 }],
      pacing: 'normal',
      continuity: 'good',
      confidence: 1.2,
      reason: 'invalid',
    })).toBeNull()
  })

  it('accepts snake_case AI output and returns camelCase analysis', () => {
    expect(parseFirstLastFrameDurationAnalysis({
      motion_beats: [{ type: 'gesture', order: 1, parallel_group: 'hands' }],
      pacing: 'normal',
      continuity: 'challenging',
      confidence: 0.7,
      reason: '动作较清晰',
    })).toEqual({
      motionBeats: [{ type: 'gesture', order: 1, parallelGroup: 'hands' }],
      pacing: 'normal',
      continuity: 'challenging',
      confidence: 0.7,
      reason: '动作较清晰',
    })
  })

  it('builds a stable fingerprint from canonical input', () => {
    expect(buildFirstLastFrameSmartDurationFingerprint({
      firstPanelId: 'a',
      lastPanelId: 'b',
      audio: [{ id: 'voice-1', durationMs: 1300 }],
    })).toBe(buildFirstLastFrameSmartDurationFingerprint({
      lastPanelId: 'b',
      audio: [{ durationMs: 1300, id: 'voice-1' }],
      firstPanelId: 'a',
    }))
  })
})
