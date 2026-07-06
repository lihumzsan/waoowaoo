import { describe, expect, it } from 'vitest'
import { validateChapterPlan } from '@/lib/edit-chapter/plan-validator'
import type { NormalizedChapterPlanOutput } from '@/lib/edit-chapter'
import type { LedgerEvent, LedgerSnapshot } from '@/lib/edit-ledger'

function planWithFacts(facts: readonly string[]): NormalizedChapterPlanOutput {
  return {
    durationSec: 3,
    shotCount: 1,
    shots: [{
      shotId: 'shot-001',
      shotNumber: 1,
      durationSec: 3,
      scene: { locationId: 'location-1', name: 'Room', subScene: 'Room' },
      action: 'A character opens the door.',
      characters: [{
        characterId: 'character-1',
        name: 'A',
        visibility: 'visible',
        role: 'focus',
        performance: 'alert',
      }],
      keyObjects: [{
        name: 'Door',
        role: 'reveal',
      }],
      sound: 'door opens',
    }],
    generationSegments: [{
      shotIds: ['shot-001'],
      continuity: 'single continuous action',
    }],
    persistentFactsIntroduced: facts,
  }
}

const entrySnapshot: LedgerSnapshot = {
  sourceEnd: 10,
  facts: ['A already owns the key'],
  entities: [{ entityType: 'character', entityName: 'A' }],
}

const chapterEvent: LedgerEvent = {
  eventId: 'event-1',
  kind: 'plot',
  sourceStart: 10,
  sourceEnd: 20,
  summary: 'A discovers the hidden room',
  entities: [{ entityType: 'location', entityName: 'Hidden room' }],
  persistentFacts: ['A knows the hidden room exists'],
}

describe('validateChapterPlan', () => {
  it('accepts persistent facts declared by the entry snapshot and chapter ledger events', () => {
    const result = validateChapterPlan({
      chapterId: 'chapter-1',
      output: planWithFacts([
        'A already owns the key',
        'A knows the hidden room exists',
      ]),
      entrySnapshot,
      events: [chapterEvent],
    })

    expect(result.ok).toBe(true)
    expect(result.persistentFactsIntroduced).toEqual([
      'A already owns the key',
      'A knows the hidden room exists',
    ])
  })

  it('fails explicitly when the chapter plan introduces a fact outside the ledger', () => {
    expect(() => validateChapterPlan({
      chapterId: 'chapter-1',
      output: planWithFacts(['A becomes king']),
      entrySnapshot,
      events: [chapterEvent],
    })).toThrow('PLAN_VALIDATION_FAILED:PERSISTENT_FACT_UNKNOWN:chapter-1:A becomes king')
  })

  it('accepts conservative rephrases of ledger-backed persistent facts', () => {
    const result = validateChapterPlan({
      chapterId: 'chapter-1',
      output: planWithFacts(['A already owns the key.']),
      entrySnapshot,
      events: [chapterEvent],
    })

    expect(result.persistentFactsIntroduced).toEqual(['A already owns the key.'])
  })

})
