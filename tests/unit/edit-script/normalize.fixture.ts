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
        shotPurpose: 'establishing',
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
        dialogue: [],
        sound: 'Soft floor creak.',
      },
      {
        shotId: 'shot-2',
        shotNumber: 2,
        shotPurpose: 'action',
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
        dialogue: [
          { characterId: 'character-anna', line: 'Who is sitting there?' },
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
        videoPrompt: 'Single-shot video prompt: Anna stays screen left beside the high-backed chair and says "Who is sitting there?", the hidden subject remains physically seated behind the chair back, floor creak continues.',
      },
    ],
    generationSegmentExecutions: [
      {
        shotIds: ['shot-1', 'shot-2'],
        continuousVideoPrompt: 'Cabin reveal continuous segment, 16:9, same high-backed chair remains centered. [00:00-00:03] Shot 1: Anna approaches from screen left while the hidden subject remains behind the chair back. <floor creak continues> [00:03-00:06] Shot 2: same-axis slow push as Anna reaches the chair and says "Who is sitting there?", while the hidden subject stays physically present. <chair hinge begins>',
      },
    ],
  } as const
}

export { describe, expect, it } from 'vitest'
export { normalizeEditScriptCore, normalizeEditShotExecutionPlan } from '@/lib/edit-script/normalize'
export type { EditScriptShot } from '@/lib/edit-script/types'
export { corePlan, executionPlan }
