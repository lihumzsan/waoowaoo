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
        shotId: 'shot-1',
        shotNumber: 1,
        durationSec: 3,
        scene: { locationId: 'location-cabin', name: 'Cabin', subScene: 'chair corner' },
        action: 'Anna studies the high-backed chair.',
        characters: [
          {
            characterId: 'character-anna',
            name: 'Anna',
            visibility: 'visible',
            role: 'focus',
            performance: 'steps closer with caution',
          },
          {
            characterId: 'character-grandmother',
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
        shotId: 'shot-2',
        shotNumber: 2,
        durationSec: 3,
        scene: { locationId: 'location-cabin', name: 'Cabin', subScene: 'beside the chair' },
        action: 'Anna reaches the chair.',
        characters: [
          {
            characterId: 'character-anna',
            name: 'Anna',
            visibility: 'partial',
            role: 'focus',
            performance: 'leans toward the chair',
          },
          {
            characterId: 'character-grandmother',
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
        shotIds: ['shot-1', 'shot-2'],
        continuity: 'Anna approaches the same high-backed chair and the hidden subject stays present.',
      },
    ],
  } as const
}

function executionPlan() {
  return {
    shots: [
      {
        shotId: 'shot-1',
        shotNumber: 1,
        camera: {
          shotScale: 'medium',
          lens: '35mm',
          focus: 'chair area sharp',
          height: 'eye level',
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
        videoPrompt: 'Single-shot video prompt: Anna remains near the doorway while the high-backed chair hides the seated subject in shadow.',
      },
      {
        shotId: 'shot-2',
        shotNumber: 2,
        camera: {
          shotScale: 'medium close',
          lens: '50mm',
          focus: 'Anna and chair edge sharp',
          height: 'eye level',
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
        videoPrompt: 'Single-shot video prompt: Anna stays screen left beside the high-backed chair, the hidden subject remains physically seated behind the chair back, floor creak continues.',
      },
    ],
    generationSegmentExecutions: [
      {
        shotIds: ['shot-1', 'shot-2'],
        continuousVideoPrompt: 'Cabin reveal continuous segment, 16:9, same high-backed chair remains centered. [00:00-00:03] Shot 1: Anna approaches from screen left while the hidden subject remains behind the chair back. <floor creak continues> [00:03-00:06] Shot 2: same-axis slow push as Anna reaches the chair and the hidden subject stays physically present. <chair hinge begins>',
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
        shotIds: ['shot-1', 'shot-2'],
        continuity: 'Anna approaches the same high-backed chair and the hidden subject stays present.',
      },
    ])
    expect(normalized.shots[0]?.characters).toContainEqual({
      characterId: 'character-grandmother',
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
      generationSegments: [{ shotIds: ['shot-2', 'shot-1'], continuity: 'wrong order' }],
    }
    expect(() => normalizeEditScriptCore(reordered)).toThrow('EDIT_SCRIPT_GENERATION_SEGMENT_ORDER_INVALID')
  })

  it('rejects generation segments whose summed shot duration exceeds the video generation cap', () => {
    const plan = corePlan()
    const oversized = {
      ...plan,
      shots: [
        { ...plan.shots[0], durationSec: 5 },
        { ...plan.shots[1], durationSec: 5 },
        {
          ...plan.shots[1],
          shotId: 'shot-3',
          shotNumber: 3,
          durationSec: 4,
          action: 'Anna turns the chair.',
        },
        {
          ...plan.shots[1],
          shotId: 'shot-4',
          shotNumber: 4,
          durationSec: 3,
          action: 'The hidden subject starts to move.',
        },
      ],
      generationSegments: [
        {
          shotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
          continuity: 'One continuous reveal movement that is too long for a single video segment.',
        },
      ],
    }

    expect(() => normalizeEditScriptCore(oversized))
      .toThrow('EDIT_SCRIPT_GENERATION_SEGMENT_DURATION_EXCEEDED:shots=shot-1,shot-2,shot-3,shot-4:duration=17:max=15')
  })
})

describe('shot execution plan normalization', () => {
  it('requires execution blocking to cover every core character and object', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const normalizedExecution = normalizeEditShotExecutionPlan(
      executionPlan(),
      normalizedCore.shots,
      normalizedCore.generationSegments,
    )

    expect(normalizedExecution.shots).toHaveLength(2)
    expect(normalizedExecution.shots[0]?.blocking.characters.map((character) => character.name)).toEqual([
      'Anna',
      'Disguised Grandmother',
    ])
    expect(normalizedExecution.shots[0]?.blocking.axis.screenDirection).toContain('screen left')
    expect(normalizedExecution.shots[0]?.camera.lighting).toContain('shadow')
    expect(normalizedExecution.shots[0]?.videoPrompt).toContain('Single-shot video prompt')
    expect(normalizedExecution.generationSegmentExecutions[0]?.continuousVideoPrompt).toContain('Cabin reveal continuous segment')
    expect(normalizedExecution.generationSegmentExecutions[0]).toEqual({
      shotIds: ['shot-1', 'shot-2'],
      continuousVideoPrompt: expect.stringContaining('hidden subject'),
    })
  })

  it('rejects redundant generation segment continuity fields', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const plan = executionPlan()
    const redundantPlan = {
      ...plan,
      generationSegmentExecutions: [
        {
          ...plan.generationSegmentExecutions[0],
          motionFlow: 'redundant split continuity field',
        },
      ],
    }

    expect(() => normalizeEditShotExecutionPlan(
      redundantPlan,
      normalizedCore.shots,
      normalizedCore.generationSegments,
    ))
      .toThrow(/Unrecognized key[\s\S]*motionFlow/)
  })

  it('normalizes copied input-only continuity and role fields before strict execution validation', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const plan = executionPlan()
    const copiedInputFieldsPlan = {
      ...plan,
      shots: plan.shots.map((shot) => ({
        ...shot,
        blocking: {
          ...shot.blocking,
          characters: shot.blocking.characters.map((character) => ({
            ...character,
            role: 'copied-input-character-role',
          })),
          objects: shot.blocking.objects.map((object) => ({
            ...object,
            role: 'copied-input-object-role',
          })),
        },
      })),
      generationSegmentExecutions: plan.generationSegmentExecutions.map((segment) => ({
        shotIds: segment.shotIds,
        continuity: segment.continuousVideoPrompt,
      })),
    }

    const normalizedExecution = normalizeEditShotExecutionPlan(
      copiedInputFieldsPlan,
      normalizedCore.shots,
      normalizedCore.generationSegments,
    )

    expect(normalizedExecution.generationSegmentExecutions[0]).toEqual({
      shotIds: ['shot-1', 'shot-2'],
      continuousVideoPrompt: expect.stringContaining('Cabin reveal continuous segment'),
    })
    expect(JSON.stringify(normalizedExecution)).not.toContain('"role":')
    expect(JSON.stringify(normalizedExecution)).not.toContain('"continuity":')
  })

  it('rejects execution plans that drop in-scene characters or required objects', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const missingCharacter = {
      generationSegmentExecutions: executionPlan().generationSegmentExecutions,
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
    expect(() => normalizeEditShotExecutionPlan(
      missingCharacter,
      normalizedCore.shots as readonly EditScriptShot[],
      normalizedCore.generationSegments,
    ))
      .toThrow('EDIT_SHOT_EXECUTION_CHARACTER_MISSING')

    const missingObject = {
      generationSegmentExecutions: executionPlan().generationSegmentExecutions,
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
    expect(() => normalizeEditShotExecutionPlan(
      missingObject,
      normalizedCore.shots as readonly EditScriptShot[],
      normalizedCore.generationSegments,
    ))
      .toThrow('EDIT_SHOT_EXECUTION_OBJECT_MISSING')
  })
})
