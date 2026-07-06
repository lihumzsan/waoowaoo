import { describe, expect, it } from 'vitest'
import { buildBgmScoreCueWindows } from '@/lib/bgm-score/generate'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'

function clip(overrides: Partial<FinalRenderClipPlan>): FinalRenderClipPlan {
  return {
    panelId: 'chapter-1',
    groupId: null,
    sourceKind: 'panel',
    source: { storageKey: 'chapter-1.mp4' },
    durationSeconds: 60,
    order: 1,
    shotNumber: null,
    shotNumbers: [1, 2],
    shotId: null,
    shotIds: ['shot-1', 'shot-2'],
    description: null,
    sound: null,
    ...overrides,
  }
}

describe('BGM score cue windows', () => {
  it('splits a long episode into provider-safe cue durations', () => {
    const cues = buildBgmScoreCueWindows([
      clip({ panelId: 'chapter-1', order: 1, durationSeconds: 120, shotIds: ['shot-1'], shotNumbers: [1] }),
      clip({ panelId: 'chapter-2', order: 2, durationSeconds: 180, shotIds: ['shot-2'], shotNumbers: [2] }),
      clip({ panelId: 'chapter-3', order: 3, durationSeconds: 320, shotIds: ['shot-3'], shotNumbers: [3] }),
    ])

    expect(cues.map((cue) => cue.durationSeconds)).toEqual([150, 150, 150, 150, 20])
    expect(cues.every((cue) => cue.durationSeconds <= 150)).toBe(true)
    expect(cues.at(-1)?.endSeconds).toBe(620)
    expect(cues[0]?.shotIds).toEqual(['shot-1', 'shot-2'])
    expect(cues[4]?.shotIds).toEqual(['shot-3'])
  })
})
