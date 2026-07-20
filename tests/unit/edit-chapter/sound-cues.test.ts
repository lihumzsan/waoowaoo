import { describe, expect, it } from 'vitest'
import { normalizeChapterPlanOutput } from '@/lib/edit-chapter'

// Test governance: Logic test for the production raw-output resolver. The oracle is
// the canonical Segment cue source reference and its explicit dialogue ownership.
describe('chapter plan Segment sound cues', () => {
  it('resolves a raw sourceShotRef into the Segment timeline without moving sync sound', () => {
    const normalized = normalizeChapterPlanOutput({
      shots: [
        {
          shotRef: 'shot-001',
          shotNumber: 1,
          shotPurpose: 'insert',
          durationSec: 2,
          scene: { locationName: 'Cafe', subScene: 'coffee cup on the table' },
          action: 'A coffee cup rests in the foreground.',
          characters: [],
          dialogue: [],
          synchronousSound: 'Cup placed on the table.',
        },
        {
          shotRef: 'shot-002',
          shotNumber: 2,
          shotPurpose: 'reaction',
          durationSec: 3,
          scene: { locationName: 'Cafe', subScene: 'the woman across the table' },
          action: 'The woman is revealed speaking across the table.',
          characters: [{ characterName: 'Woman', performance: 'holds her gaze on the listener' }],
          dialogue: [{ speakerName: 'Woman', line: 'Are you really leaving?' }],
          synchronousSound: 'Soft cafe room tone.',
        },
      ],
      generationSegments: [{
        shotRefs: ['shot-001', 'shot-002'],
        continuity: 'The same cafe conversation continues through the reveal.',
        soundCues: [{
          kind: 'dialogue',
          description: 'The woman speaks offscreen before the reveal.',
          startSec: 0,
          endSec: 3,
          sourceShotRef: 'shot-002',
        }],
      }],
    }, {
      locations: [{ id: 'location-cafe', name: 'Cafe', description: 'A cafe.' }],
      characters: [{ id: 'character-woman', name: 'Woman', description: 'A woman.' }],
    })

    expect(normalized.shots[0]?.synchronousSound).toBe('Cup placed on the table.')
    expect(normalized.generationSegments[0]?.soundCues).toEqual([{
      kind: 'dialogue',
      description: 'The woman speaks offscreen before the reveal.',
      startSec: 0,
      endSec: 3,
      sourceShotId: 'shot-002',
    }])
  })
})
