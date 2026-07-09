import { describe, expect, it } from 'vitest'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import {
  buildSoundscapeTimelineSignature,
  resolveSoundscapeSectionTimeline,
} from '@/lib/soundscape/timeline'
import type { SoundscapePlan } from '@/lib/soundscape/types'

function clip(input: {
  readonly order: number
  readonly panelId: string
  readonly durationSeconds: number
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
}): FinalRenderClipPlan {
  return {
    panelId: input.panelId,
    groupId: null,
    sourceKind: 'videoGroup',
    source: `storage/${input.panelId}.mp4`,
    durationSeconds: input.durationSeconds,
    order: input.order,
    shotNumber: input.shotNumbers[0] ?? null,
    shotNumbers: input.shotNumbers,
    shotId: input.shotIds[0] ?? null,
    shotIds: input.shotIds,
    description: null,
    sound: null,
  }
}

const clips = [
  clip({ order: 1, panelId: 'clip-1', durationSeconds: 2.5, shotIds: ['shot_001'], shotNumbers: [1] }),
  clip({ order: 2, panelId: 'clip-2', durationSeconds: 4, shotIds: ['shot_002'], shotNumbers: [2] }),
  clip({ order: 3, panelId: 'clip-3', durationSeconds: 3.25, shotIds: ['shot_003', 'shot_004'], shotNumbers: [3, 4] }),
] as const

const plan: SoundscapePlan = {
  schemaVersion: 1,
  decision: 'soundscape',
  sources: [{
    sourceId: 'city_wind',
    environmentFingerprint: 'night_city_wind',
    prompt: 'Seamless loop of steady city wind, no music, no voices, no footsteps.',
    loopDurationSeconds: 30,
    promptInfluence: 0.55,
  }],
  sections: [{
    sourceId: 'city_wind',
    fromShotId: 'shot_002',
    toShotId: 'shot_004',
    perspective: 'interior',
    intensity: 'low',
    transitionIn: 'fade',
    transitionOut: 'crossfade',
  }],
}

describe('soundscape timeline', () => {
  it('resolves shot anchors into absolute episode seconds from clip order and duration', () => {
    const sections = resolveSoundscapeSectionTimeline({ clips, plan })

    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({
      section: plan.sections[0],
      index: 0,
      startSeconds: 2.5,
      endSeconds: 9.75,
      durationSeconds: 7.25,
      sourceClipOrders: [2, 3],
      shotIds: ['shot_002', 'shot_003', 'shot_004'],
      shotNumbers: [2, 3, 4],
    })
  })

  it('returns no sections for an explicit none_needed decision', () => {
    const sections = resolveSoundscapeSectionTimeline({
      clips,
      plan: {
        schemaVersion: 1,
        decision: 'none_needed',
        sources: [],
        sections: [],
      },
    })

    expect(sections).toEqual([])
  })

  it('changes timelineSignature when clip duration changes', () => {
    const signature = buildSoundscapeTimelineSignature(clips)
    const changedSignature = buildSoundscapeTimelineSignature([
      clips[0],
      { ...clips[1], durationSeconds: 4.5 },
      clips[2],
    ])

    expect(signature).toBe('160bc5085ba33426aa399306')
    expect(changedSignature).toBe('62e0eed2c6aacf9c3b1ec130')
    expect(changedSignature).not.toBe(signature)
  })

  it('fails when shot anchors are missing or ordered backwards', () => {
    expect(() => resolveSoundscapeSectionTimeline({
      clips,
      plan: {
        ...plan,
        sections: [{
          ...plan.sections[0],
          fromShotId: 'shot_999',
        }],
      },
    })).toThrow('SOUNDSCAPE_SHOT_ANCHOR_NOT_FOUND:shot_999')

    expect(() => resolveSoundscapeSectionTimeline({
      clips,
      plan: {
        ...plan,
        sections: [{
          ...plan.sections[0],
          fromShotId: 'shot_004',
          toShotId: 'shot_002',
        }],
      },
    })).toThrow('SOUNDSCAPE_SHOT_ANCHOR_ORDER_INVALID:shot_004:shot_002')
  })
})
