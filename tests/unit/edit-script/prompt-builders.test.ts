import { describe, expect, it } from 'vitest'
import {
  buildStoryboardGridPromptFacts,
  buildStoryboardStillPromptFacts,
  buildStoryboardVideoSegmentPromptFacts,
} from '@/lib/edit-script/prompt-builders'
import type {
  EditGenerationSegment,
  EditScriptShot,
  EditScriptStyleBible,
  EditShotExecution,
} from '@/lib/edit-script/types'
import type { StoryboardConsistencyAssetSnapshot } from '@/lib/edit-script/storyboard-consistency/types'

const styleBible: EditScriptStyleBible = {
  rawUserStyle: null,
  styleSummary: 'restrained gothic stop-motion',
  stylePolicy: {
    directing: {
      pointOfViewPrompt: 'subjective suspense',
      performancePrompt: 'small cautious gestures',
      informationReleasePrompt: 'hide the seated figure until the reveal',
      rhythmPrompt: 'slow approach',
    },
    visual: {
      imageFilterPrompt: 'cinematic miniature texture',
      lightingPrompt: 'cold top light and deep chair shadow',
      colorPrompt: 'muted red and blue-grey',
      texturePrompt: 'weathered wood and fabric',
      compositionPrompt: 'centered reveal composition',
    },
    camera: {
      movementPrompt: 'locked or slow push',
      lensAndDepthPrompt: '35mm to 50mm shallow edge falloff',
      videoRhythmPrompt: 'continuous suspense beat',
    },
    sound: {
      soundFilterPrompt: 'quiet room tone',
    },
  },
}

const segment: EditGenerationSegment = {
  shotNumbers: [11, 12, 13],
  continuity: 'Anna approaches the high-backed chair and the hidden seated figure remains present.',
}

const shot11: EditScriptShot = {
  shotNumber: 11,
  durationSec: 3,
  scene: { name: 'Cabin living room' },
  action: 'A high-backed chair stands in the center of the room.',
  characters: [
    {
      name: 'Disguised Grandmother',
      visibility: 'hidden',
      role: 'hidden_subject',
      performance: 'sits motionless inside the chair',
    },
  ],
  keyObjects: [
    { name: 'High-backed chair', role: 'reveal_device' },
  ],
  sound: 'The room is quiet.',
}

const shot12: EditScriptShot = {
  shotNumber: 12,
  durationSec: 3,
  scene: { name: 'Cabin living room' },
  action: 'Anna steps toward the chair.',
  characters: [
    {
      name: 'Anna',
      visibility: 'visible',
      role: 'focus',
      performance: 'walks cautiously',
    },
    {
      name: 'Disguised Grandmother',
      visibility: 'hidden',
      role: 'hidden_subject',
      performance: 'stays seated behind the chair back',
    },
  ],
  keyObjects: [
    { name: 'High-backed chair', role: 'reveal_device' },
  ],
  sound: 'Floorboards creak.',
}

const execution11: EditShotExecution = {
  shotNumber: 11,
  camera: {
    shotScale: 'medium',
    lens: '35mm',
    focus: 'chair clear',
    height: 'eye level',
    angle: 'slightly low',
    movement: 'locked off',
    composition: 'chair centered',
    lighting: 'top cold light hides the seated figure in shadow',
  },
  blocking: {
    axis: {
      type: 'subject_line',
      subjects: ['High-backed chair', 'Anna'],
      screenDirection: 'chair stays center; Anna later enters from screen left',
    },
    characters: [
      {
        name: 'Disguised Grandmother',
        visibility: 'hidden',
        position: 'seated inside the high-backed chair',
        screenPosition: 'behind the chair back',
        facing: 'away from door',
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
    spatialNote: 'The hidden subject remains present but concealed.',
  },
}

const execution12: EditShotExecution = {
  ...execution11,
  shotNumber: 12,
  camera: {
    ...execution11.camera,
    movement: 'slow push',
    composition: 'Anna left, chair center',
  },
  blocking: {
    ...execution11.blocking,
    characters: [
      {
        name: 'Anna',
        visibility: 'visible',
        position: 'approaching from doorway',
        screenPosition: 'left foreground',
        facing: 'toward chair',
        eyeline: 'chair back',
      },
      execution11.blocking.characters[0],
    ],
  },
}

const assets: readonly StoryboardConsistencyAssetSnapshot[] = [
  {
    requirementId: 'req-location',
    kind: 'location',
    name: 'Cabin living room',
    description: 'A cramped wooden room with a central high-backed chair.',
    shotNumbers: [11, 12, 13],
    targetId: 'location-1',
    previewImageUrl: 'https://cdn.test/location.png',
    spatialProfile: {
      schemaVersion: 1,
      sceneSummary: 'chair centered, door to the left',
      anchors: [
        {
          id: 'chair',
          label: 'High-backed chair',
          screenArea: 'center frame',
          depthLayer: 'midground',
          spatialRelations: ['door remains left of the chair'],
        },
      ],
      depthLayout: {
        foreground: 'doorway and Anna approach path',
        midground: 'high-backed chair',
        background: 'wooden wall',
      },
      lightingDirection: 'cold top light',
    },
  },
  {
    requirementId: 'req-grandmother',
    kind: 'character',
    name: 'Disguised Grandmother',
    description: 'A hidden seated figure.',
    shotNumbers: [11, 12, 13],
    targetId: 'character-1',
    previewImageUrl: 'https://cdn.test/grandmother.png',
  },
  {
    requirementId: 'req-anna',
    kind: 'character',
    name: 'Anna',
    description: 'A cautious girl in a red hood.',
    shotNumbers: [12, 13],
    targetId: 'character-2',
    previewImageUrl: 'https://cdn.test/anna.png',
  },
]

describe('storyboard prompt builders', () => {
  it('keeps hidden in-scene characters in CHARACTER_GRAPH and reference images', () => {
    const result = buildStoryboardStillPromptFacts({
      shot: shot11,
      execution: execution11,
      segment,
      sourceGenerationSegmentId: 'edit-1:generationSegment:1',
      assets,
      styleBible,
    })

    expect(result.facts.CHARACTER_GRAPH).toEqual([
      expect.objectContaining({
        name: 'Disguised Grandmother',
        visibility: 'hidden',
        role: 'hidden_subject',
        position: 'seated inside the high-backed chair',
        referenceImageUrl: 'https://cdn.test/grandmother.png',
      }),
    ])
    expect(result.facts.REFERENCE_IMAGES).toContainEqual({
      kind: 'character',
      name: 'Disguised Grandmother',
      visibility: 'hidden',
      url: 'https://cdn.test/grandmother.png',
    })
    expect(result.prompt).toContain('CHARACTER_GRAPH')
    expect(result.prompt).not.toContain('videoPrompt')
    expect(result.prompt).not.toContain('cameraMove')
  })

  it('keeps supporting conversation participants in grid blocking facts', () => {
    const result = buildStoryboardGridPromptFacts({
      segment,
      sourceGenerationSegmentId: 'edit-1:generationSegment:1',
      shots: [shot11, shot12],
      executions: [execution11, execution12],
      assets,
      styleBible,
    })

    expect(result.facts.CHARACTER_GRAPH.map((character) => character.name)).toEqual([
      'Disguised Grandmother',
      'Anna',
      'Disguised Grandmother',
    ])
    expect(result.facts.BLOCKING_STATE).toHaveLength(2)
    expect(result.prompt).toContain('BLOCKING_STATE')
    expect(result.prompt).toContain('shotDelta')
  })

  it('builds video segment prompts from generation segment continuity instead of saved segment prompts', () => {
    const result = buildStoryboardVideoSegmentPromptFacts({
      segment,
      sourceGenerationSegmentId: 'edit-1:generationSegment:1',
      shots: [shot11, shot12],
      executions: [execution11, execution12],
      assets,
      styleBible,
    })

    expect(result.facts.GENERATION_SEGMENT).toEqual({
      sourceGenerationSegmentId: 'edit-1:generationSegment:1',
      shotNumbers: [11, 12, 13],
      continuity: 'Anna approaches the high-backed chair and the hidden seated figure remains present.',
      sound: [
        { shotNumber: 11, sound: 'The room is quiet.' },
        { shotNumber: 12, sound: 'Floorboards creak.' },
      ],
    })
    expect(result.prompt).toContain('Generate one continuous video segment')
  })
})
