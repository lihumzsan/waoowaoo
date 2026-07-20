import { describe, expect, it } from 'vitest'

import {
  normalizeEditScriptCore,
  normalizeEditShotExecutionPlan,
} from '@/lib/edit-script/normalize'

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
          { characterId: 'character-anna', name: 'Anna', performance: 'steps closer with caution' },
          { characterId: 'character-grandmother', name: 'Disguised Grandmother', performance: 'sits silently inside the high-backed chair' },
        ],
        dialogue: [],
        synchronousSound: 'Soft floor creak.',
      },
      {
        shotId: 'shot-2',
        shotNumber: 2,
        shotPurpose: 'action',
        durationSec: 3,
        scene: { locationId: 'location-cabin', name: 'Cabin', subScene: 'beside the chair' },
        action: 'Anna reaches the chair.',
        characters: [
          { characterId: 'character-anna', name: 'Anna', performance: 'leans toward the chair' },
          { characterId: 'character-grandmother', name: 'Disguised Grandmother', performance: 'remains seated behind the chair back' },
        ],
        dialogue: [{ characterId: 'character-anna', line: 'Who is sitting there?' }],
        synchronousSound: 'Chair hinge starts to groan.',
      },
    ],
    generationSegments: [
      {
        segmentId: 'segment-1',
        shotIds: ['shot-1', 'shot-2'],
        continuity: 'Anna approaches the same high-backed chair in one continuous space.',
        soundCues: [],
      },
    ],
  } as const
}

function executionPlan() {
  return {
    generationSegments: [
      {
        segmentRef: 'segment-001',
        shots: [
          {
            shotRef: 'shot-001',
            shotScale: 'medium',
            cameraMovement: { movement: 'locked off', stability: 'locked' },
          },
          {
            shotRef: 'shot-002',
            shotScale: 'medium close',
            cameraMovement: { movement: 'slow push', stability: 'smooth' },
          },
        ],
      },
    ],
  } as const
}

export { describe, expect, it }
export { normalizeEditScriptCore, normalizeEditShotExecutionPlan }
export { corePlan, executionPlan }
