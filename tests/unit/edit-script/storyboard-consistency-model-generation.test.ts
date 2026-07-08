import { describe, expect, it } from 'vitest'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'
import { generateStoryboardPanelPrompts } from '@/lib/edit-script/storyboard-consistency/model-generation'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

const SINGLE_SHOT_VIDEO_PROMPT = 'ShotExecutionPlan single-shot video prompt: hold a medium shot of Anna beside the high-backed chair, preserve chair shadow and room tone.'

function buildSnapshot(): StoryboardConsistencySourceSnapshot {
  return {
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId: 'chapter-1',
    project: { videoRatio: '16:9' },
    editScript: {
      id: 'edit-script-1',
      durationSec: 3,
      shotCount: 1,
      sourceText: 'test bible',
    },
    styleBible: buildZenStyleBibleFixture(),
    shots: [
      {
        shotId: 'shot-1',
        shotNumber: 1,
        shotPurpose: 'action',
        durationSec: 3,
        scene: { locationId: 'location-1', name: 'Cabin living room', subScene: 'Cabin living room' },
        action: 'Anna approaches the high-backed chair.',
        characters: [
          {
            characterId: 'character-anna',
            name: 'Anna',
            visibility: 'visible',
            role: 'focus',
            performance: 'moves carefully toward the chair',
          },
          {
            characterId: 'character-grandmother',
            name: 'Disguised Grandmother',
            visibility: 'hidden',
            role: 'hidden_subject',
            performance: 'sits motionless inside the chair',
          },
        ],
        keyObjects: [
          { name: 'High-backed chair', role: 'reveal_device' },
        ],
        sound: 'floorboards creak',
      },
    ],
    shotExecutionPlan: {
      shots: [
        {
          shotId: 'shot-1',
          shotNumber: 1,
          camera: {
            shotScale: 'medium',
            lens: '35mm',
            focus: 'chair and Anna clear',
            height: 'eye level',
            angle: 'straight-on',
            movement: 'slow push',
            composition: 'Anna screen left, chair center, hidden subject behind chair back',
            lighting: 'cold top light hides the seated figure in chair shadow',
          },
          blocking: {
            axis: {
              type: 'subject_line',
              subjects: ['Anna', 'High-backed chair'],
              screenDirection: 'Anna remains screen left of the centered chair',
            },
            characters: [
              {
                name: 'Anna',
                visibility: 'visible',
                position: 'beside the chair',
                screenPosition: 'screen left',
                facing: 'toward the chair',
                eyeline: 'chair back',
              },
              {
                name: 'Disguised Grandmother',
                visibility: 'hidden',
                position: 'seated inside the high-backed chair',
                screenPosition: 'behind the chair back',
                facing: 'away from Anna',
                eyeline: 'not visible',
              },
            ],
            objects: [
              {
                name: 'High-backed chair',
                position: 'room center',
                screenPosition: 'frame center',
              },
            ],
            spatialNote: 'The hidden subject remains physically present behind the chair back.',
          },
          videoPrompt: SINGLE_SHOT_VIDEO_PROMPT,
        },
      ],
      generationSegmentExecutions: [
        {
          shotIds: ['shot-1'],
          continuousVideoPrompt: 'Continuous segment prompt. [00:00-00:03] Shot 1 preserves the chair axis and hidden subject.',
        },
      ],
    },
    generationSegments: [
      {
        shotIds: ['shot-1'],
        continuity: 'Anna approaches the chair in one beat.',
        segmentIndex: 0,
        sourceGenerationSegmentId: 'edit-script-1:generationSegment:1',
      },
    ],
    assets: [],
  }
}

describe('storyboard consistency model generation', () => {
  it('uses ShotExecutionPlan videoPrompt as the panel video prompt source', () => {
    const panels = generateStoryboardPanelPrompts({ snapshot: buildSnapshot() })

    expect(panels).toHaveLength(1)
    expect(panels[0]?.videoPrompt).toBe(SINGLE_SHOT_VIDEO_PROMPT)
    expect(panels[0]?.prompt).toContain('Generate one storyboard still image')
  })
})
