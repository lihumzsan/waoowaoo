import { describe, expect, it } from 'vitest'
import { resolveCompositionTiming } from '@/lib/video-compose/composition-timing'
import type { VideoComposition } from '@/lib/video-compose/composition-contract'

function composition(): VideoComposition {
  return {
    schemaVersion: 1,
    clips: [
      {
        clipId: 'second-use',
        source: { resourceId: 'same-video', contentVersion: 1 },
        sourceStartMs: 4_000,
        durationMs: 2_000,
      },
      {
        clipId: 'first-use',
        source: { resourceId: 'same-video', contentVersion: 1 },
        sourceStartMs: 0,
        durationMs: 3_000,
      },
    ],
    textLayers: [
      {
        layerId: 'name',
        clipId: 'first-use',
        startOffsetMs: 500,
        durationMs: 1_000,
        name: '角色',
        description: null,
        nameSource: { kind: 'user_instruction' },
        styleKey: 'lower_third',
        placementKey: 'bottom_left',
        intro: { kind: 'none' },
        outro: { kind: 'none' },
      },
    ],
    audio: { mode: 'preserve', musicCues: [], soundCues: [] },
    contextReferences: [],
  }
}

describe('composition half-open interval mapping', () => {
  it('anchors text to the selected use after reordering a repeated source', () => {
    const input = composition()
    const result = resolveCompositionTiming(input, '24/1')
    expect(result.durationMs).toBe(5_000)
    expect(result.clips.map((clip) => clip.targetStartMs)).toEqual([0, 2_000])
    expect(result.textLayers[0].targetStartMs).toBe(2_500)
    input.clips.reverse()
    expect(
      resolveCompositionTiming(input, '24/1').textLayers[0].targetStartMs,
    ).toBe(500)
  })

  it('rejects a text interval extending past the bound clip instead of truncating it', () => {
    const input = composition()
    input.textLayers[0].durationMs = 2_501
    expect(() => resolveCompositionTiming(input, '24/1')).toThrow()
  })
})

describe('one rational frame clock', () => {
  it('quantizes cumulative endpoints instead of rounding each short clip', () => {
    const input = composition()
    input.textLayers = []
    input.clips = [0, 1, 2].map((index) => ({
      ...input.clips[0]!,
      clipId: `clip-${index}`,
      sourceStartMs: 0,
      durationMs: 100,
    }))
    const result = resolveCompositionTiming(input, '24/1')
    expect(result.clips.map((clip) => clip.videoFrameCount)).toEqual([2, 3, 2])
    expect(result.videoFrameCount).toBe(7)
    expect(result.videoDurationUs).toBe(291667)
    expect(result.durationMs).toBe(300)
    expect(result.clips.map((clip) => clip.targetStartMs)).toEqual([
      0, 100, 200,
    ])
  })
  it('bounds total error to half a rational frame across many cuts', () => {
    const input = composition()
    input.textLayers = []
    input.clips = Array.from({ length: 50 }, (_, index) => ({
      ...input.clips[0]!,
      clipId: `clip-${index}`,
      sourceStartMs: 0,
      durationMs: 100,
    }))
    const result = resolveCompositionTiming(input, '30000/1001')
    expect(result.videoFrameCount).toBe(150)
    expect(result.videoDurationUs).toBe(5005000)
    expect(
      result.clips.reduce((sum, clip) => sum + clip.videoFrameCount, 0),
    ).toBe(150)
    expect(
      Math.abs(result.videoDurationUs - result.durationMs * 1000),
    ).toBeLessThanOrEqual(1001000 / 60)
  })
  it('rejects a clip that disappears on the output frame grid', () => {
    const input = composition()
    input.textLayers = []
    input.clips[0]!.durationMs = 1
    expect(() => resolveCompositionTiming(input, '24/1')).toThrow()
  })
})
