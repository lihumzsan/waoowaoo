import { describe, expect, it } from 'vitest'
import {
  buildStoryboardStillPromptFacts,
} from '@/lib/edit-script/prompt-builders'
import type {
  EditScriptShot,
  EditScriptStyleBible,
  EditShotExecution,
} from '@/lib/edit-script/types'

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

const shot11: EditScriptShot = {
  shotId: 'shot-11',
  shotNumber: 11,
  shotPurpose: 'action',
  durationSec: 3,
  scene: { locationId: 'location-1', name: 'Cabin living room', subScene: 'Cabin living room' },
  action: 'A high-backed chair stands in the center of the room.',
  characters: [
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
  dialogue: [],
  sound: 'The room is quiet.',
}

const shot12: EditScriptShot = {
  shotId: 'shot-12',
  shotNumber: 12,
  shotPurpose: 'action',
  durationSec: 3,
  scene: { locationId: 'location-1', name: 'Cabin living room', subScene: 'Cabin living room' },
  action: 'Anna steps toward the chair.',
  characters: [
    {
      characterId: 'character-anna',
      name: 'Anna',
      visibility: 'visible',
      role: 'focus',
      performance: 'walks cautiously',
    },
    {
      characterId: 'character-grandmother',
      name: 'Disguised Grandmother',
      visibility: 'hidden',
      role: 'hidden_subject',
      performance: 'stays seated behind the chair back',
    },
  ],
  keyObjects: [
    { name: 'High-backed chair', role: 'reveal_device' },
  ],
  dialogue: [],
  sound: 'Floorboards creak.',
}

const execution11: EditShotExecution = {
  shotId: 'shot-11',
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
  videoPrompt: 'Single-shot video prompt for shot 11: hold on the centered high-backed chair while the hidden subject remains physically seated behind the chair back.',
}

const execution12: EditShotExecution = {
  ...execution11,
  shotId: 'shot-12',
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

describe('storyboard prompt builders', () => {
  it('keeps hidden in-scene characters in minimal still facts without reference URL text', () => {
    const result = buildStoryboardStillPromptFacts({
      shot: shot11,
      execution: execution11,
      styleBible,
    })

    expect(result.facts.CHARACTERS).toEqual([
      expect.objectContaining({
        name: 'Disguised Grandmother',
        visibility: 'hidden',
        role: 'hidden_subject',
        position: 'seated inside the high-backed chair',
      }),
    ])
    expect(result.facts.SCENE).toEqual({
      name: 'Cabin living room',
      action: 'A high-backed chair stands in the center of the room.',
    })
    expect(result.facts.CAMERA).toEqual({
      shotScale: 'medium',
      lens: '35mm',
      focus: 'chair clear',
      height: 'eye level',
      angle: 'slightly low',
      composition: 'chair centered',
      lighting: 'top cold light hides the seated figure in shadow',
    })
    expect(result.facts.AXIS).toEqual({
      subjects: ['High-backed chair', 'Anna'],
      screenDirection: 'chair stays center; Anna later enters from screen left',
    })
    expect(result.prompt).toContain('SCENE')
    expect(result.prompt).toContain('CHARACTERS')
    expect(result.prompt).toContain('PROPS')
    expect(result.prompt).toContain('CAMERA')
    expect(result.prompt).toContain('AXIS')
    expect(result.prompt).toContain('STYLE')
    expect(result.prompt).not.toContain('NEGATIVE')
    expect(result.prompt).not.toContain('REFERENCE_IMAGES')
    expect(result.prompt).not.toContain('referenceImageUrl')
    expect(result.prompt).not.toContain('spatialProfile')
    expect(result.prompt).not.toContain('shotNumber')
    expect(result.prompt).not.toContain('durationSec')
    expect(result.prompt).not.toContain('generationSegment')
    expect(result.prompt).not.toContain('movement')
    expect(result.prompt).not.toContain('spatialNote')
    expect(result.prompt).not.toContain('https://cdn.test')
    expect(result.prompt).not.toContain('videoPrompt')
    expect(result.prompt).not.toContain('cameraMove')

  })

})
