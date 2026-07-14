import { describe, expect, it } from 'vitest'
import { buildChapterPlanOutputSchema, projectChapterPersistentFacts } from '@/lib/edit-chapter'
import type { LedgerEvent } from '@/lib/edit-ledger'

function event(eventId: string, persistentFacts: readonly string[]): LedgerEvent {
  return {
    eventId,
    kind: 'plot',
    sourceStart: 0,
    sourceEnd: 1,
    summary: eventId,
    entities: [],
    persistentFacts: [...persistentFacts],
  }
}

describe('projectChapterPersistentFacts', () => {
  it('projects exact event facts in ledger order and removes duplicates', () => {
    expect(projectChapterPersistentFacts([
      event('event-1', ['阿杰走进水泥密室。', '铁门锁死，阿杰被困。']),
      event('event-2', ['铁门锁死，阿杰被困。', '手机失去信号。']),
    ])).toEqual([
      '阿杰走进水泥密室。',
      '铁门锁死，阿杰被困。',
      '手机失去信号。',
    ])
  })

  it('rejects the retired model-authored persistent fact field', () => {
    const schema = buildChapterPlanOutputSchema({
      locations: [{ id: 'location-1', name: '密室', description: '章节场景' }],
      characters: [{ id: 'character-1', name: '阿杰', description: '主角' }],
    })
    const result = schema.safeParse({
      shots: [{
        shotRef: 'shot-001',
        shotNumber: 1,
        shotPurpose: 'action',
        durationSec: 3,
        scene: { locationName: '密室', subScene: '铁门内侧' },
        action: '阿杰推门进入。',
        characters: [{
          characterName: '阿杰',
          performance: '谨慎前进',
        }],
        dialogue: [],
        synchronousSound: '铁门摩擦声',
      }],
      generationSegments: [{ shotRefs: ['shot-001'], continuity: '同一进入动作' }],
      persistentFactsIntroduced: ['阿杰进入密室。'],
    })

    expect(result.success).toBe(false)
  })

  it('rejects an empty performance in the asset-scoped chapter output', () => {
    const schema = buildChapterPlanOutputSchema({
      locations: [{ id: 'location-1', name: '密室', description: '章节场景' }],
      characters: [{ id: 'character-1', name: '阿杰', description: '主角' }],
    })

    const result = schema.safeParse({
      shots: [{
        shotRef: 'shot-001',
        shotNumber: 1,
        shotPurpose: 'action',
        durationSec: 3,
        scene: { locationName: '密室', subScene: '铁门内侧' },
        action: '阿杰推门进入。',
        characters: [{
          characterName: '阿杰',
          performance: '',
        }],
        dialogue: [],
        synchronousSound: '铁门摩擦声',
      }],
      generationSegments: [{ shotRefs: ['shot-001'], continuity: '同一进入动作' }],
    })

    expect(result.success).toBe(false)
  })
})
