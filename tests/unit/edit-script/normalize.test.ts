import { describe, expect, it } from 'vitest'
import {
  normalizeEditScriptCore,
  normalizeEditShotExecutionPlan,
} from '@/lib/edit-script/normalize'
import type { EditScriptShot } from '@/lib/edit-script/types'

function corePlan() {
  return {
    shots: [
      {
        shotNumber: 1,
        durationSec: 3,
        scene: { name: 'Cabin' },
        action: 'Anna studies the high-backed chair.',
        characters: [
          {
            name: 'Anna',
            visibility: 'visible',
            role: 'focus',
            performance: 'steps closer with caution',
          },
          {
            name: 'Disguised Grandmother',
            visibility: 'hidden',
            role: 'hidden_subject',
            performance: 'sits silently inside the high-backed chair',
          },
        ],
        keyObjects: [
          { name: 'High-backed chair', role: 'reveal_device' },
        ],
        sound: 'Soft floor creak.',
      },
      {
        shotNumber: 2,
        durationSec: 3,
        scene: { name: 'Cabin' },
        action: 'Anna reaches the chair.',
        characters: [
          {
            name: 'Anna',
            visibility: 'partial',
            role: 'focus',
            performance: 'leans toward the chair',
          },
          {
            name: 'Disguised Grandmother',
            visibility: 'hidden',
            role: 'hidden_subject',
            performance: 'remains seated behind the chair back',
          },
        ],
        keyObjects: [
          { name: 'High-backed chair', role: 'reveal_device' },
        ],
        sound: 'Chair hinge starts to groan.',
      },
    ],
    generationSegments: [
      {
        shotNumbers: [1, 2],
        continuity: 'Anna approaches the same high-backed chair and the hidden subject stays present.',
      },
    ],
  } as const
}

function executionPlan() {
  return {
    shots: [
      {
        shotNumber: 1,
        camera: {
          shotScale: 'medium',
          lens: '35mm',
          focus: 'chair area sharp',
          height: 'eye level',
          position: 'inside doorway left',
          angle: 'slightly low frontal',
          movement: 'locked off',
          composition: 'chair centered',
          lighting: 'cold top light hides the seated figure in shadow',
        },
        blocking: {
          axis: {
            type: 'subject_line',
            subjects: ['Anna', 'High-backed chair'],
            screenDirection: 'chair remains center; Anna approaches from screen left',
          },
          characters: [
            {
              name: 'Anna',
              visibility: 'visible',
              position: 'near the doorway',
              screenPosition: 'left foreground',
              facing: 'toward the chair',
              eyeline: 'chair center',
            },
            {
              name: 'Disguised Grandmother',
              visibility: 'hidden',
              position: 'seated inside the high-backed chair',
              screenPosition: 'behind the chair back',
              facing: 'away from the doorway',
              eyeline: 'not visible',
            },
          ],
          objects: [
            {
              name: 'High-backed chair',
              position: 'center of the cabin',
              screenPosition: 'frame center',
            },
          ],
          spatialNote: 'The hidden subject remains present but concealed by the chair back.',
        },
      },
      {
        shotNumber: 2,
        camera: {
          shotScale: 'medium close',
          lens: '50mm',
          focus: 'Anna and chair edge sharp',
          height: 'eye level',
          position: 'inside doorway left, closer',
          angle: 'frontal',
          movement: 'slow push',
          composition: 'Anna left, chair center',
          lighting: 'top light still keeps the seated figure hidden',
        },
        blocking: {
          axis: {
            type: 'subject_line',
            subjects: ['Anna', 'High-backed chair'],
            screenDirection: 'Anna remains screen left and chair remains center',
          },
          characters: [
            {
              name: 'Anna',
              visibility: 'partial',
              position: 'beside the chair',
              screenPosition: 'left midground',
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
              position: 'center of the cabin',
              screenPosition: 'frame center',
            },
          ],
          spatialNote: 'The hidden subject remains physically in the chair.',
        },
      },
    ],
  } as const
}

describe('edit-first core plan normalization', () => {
  it('normalizes the compact core plan and preserves hidden_subject characters', () => {
    const normalized = normalizeEditScriptCore(corePlan())

    expect(normalized.shotCount).toBe(2)
    expect(normalized.durationSec).toBe(6)
    expect(normalized.generationSegments).toEqual([
      {
        shotNumbers: [1, 2],
        continuity: 'Anna approaches the same high-backed chair and the hidden subject stays present.',
      },
    ])
    expect(normalized.shots[0]?.characters).toContainEqual({
      name: 'Disguised Grandmother',
      visibility: 'hidden',
      role: 'hidden_subject',
      performance: 'sits silently inside the high-backed chair',
    })
  })

  it('rejects non-continuous shot numbers and unordered generation segment coverage', () => {
    const plan = corePlan()
    const nonContinuous = {
      ...plan,
      shots: [
        plan.shots[0],
        { ...plan.shots[1], shotNumber: 3 },
      ],
    }
    expect(() => normalizeEditScriptCore(nonContinuous)).toThrow('EDIT_SCRIPT_SHOT_NUMBER_NOT_CONTINUOUS')

    const reordered = {
      ...plan,
      generationSegments: [{ shotNumbers: [2, 1], continuity: 'wrong order' }],
    }
    expect(() => normalizeEditScriptCore(reordered)).toThrow('EDIT_SCRIPT_GENERATION_SEGMENT_ORDER_INVALID')
  })
})

describe('shot execution plan normalization', () => {
  it('requires execution blocking to cover every core character and object', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const normalizedExecution = normalizeEditShotExecutionPlan(executionPlan(), normalizedCore.shots)

    expect(normalizedExecution.shots).toHaveLength(2)
    expect(normalizedExecution.shots[0]?.blocking.characters.map((character) => character.name)).toEqual([
      'Anna',
      'Disguised Grandmother',
    ])
    expect(normalizedExecution.shots[0]?.blocking.axis.screenDirection).toContain('screen left')
    expect(normalizedExecution.shots[0]?.camera.lighting).toContain('shadow')
  })

  it('rejects execution plans that drop in-scene characters or required objects', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const missingCharacter = {
      shots: [
        {
          ...executionPlan().shots[0],
          blocking: {
            ...executionPlan().shots[0].blocking,
            characters: [executionPlan().shots[0].blocking.characters[0]],
          },
        },
        executionPlan().shots[1],
      ],
    }
    expect(() => normalizeEditShotExecutionPlan(missingCharacter, normalizedCore.shots as readonly EditScriptShot[]))
      .toThrow('EDIT_SHOT_EXECUTION_CHARACTER_MISSING')

    const missingObject = {
      shots: [
        {
          ...executionPlan().shots[0],
          blocking: {
            ...executionPlan().shots[0].blocking,
            objects: [],
          },
        },
        executionPlan().shots[1],
      ],
    }
    expect(() => normalizeEditShotExecutionPlan(missingObject, normalizedCore.shots as readonly EditScriptShot[]))
      .toThrow('EDIT_SHOT_EXECUTION_OBJECT_MISSING')
  })
})
