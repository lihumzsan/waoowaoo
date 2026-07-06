import { describe, expect, it } from 'vitest'
import {
  collectLedgerEventsInRange,
  projectLedgerSnapshotAtSourceOffset,
  type Ledger,
} from '@/lib/edit-ledger'

const ledger: Ledger = {
  events: [
    {
      eventId: 'event-1',
      kind: 'appearance',
      summary: '主角出场',
      sourceStart: 0,
      sourceEnd: 10,
      entities: [{ entityType: 'character', entityName: '林秋' }],
      persistentFacts: ['林秋已经进入车站'],
    },
    {
      eventId: 'event-2',
      kind: 'location',
      summary: '转入站台',
      sourceStart: 20,
      sourceEnd: 30,
      entities: [{ entityType: 'location', entityName: '旧车站' }],
      persistentFacts: ['旧车站开始断电'],
    },
    {
      eventId: 'event-crossing',
      kind: 'plot',
      summary: '一段事件跨过切点。',
      sourceStart: 28,
      sourceEnd: 42,
      entities: [{ entityType: 'world', entityName: '切点' }],
      persistentFacts: ['跨界事件不能丢失'],
    },
  ],
}

describe('edit ledger projection', () => {
  it('projects persistent facts up to a source offset', () => {
    const snapshot = projectLedgerSnapshotAtSourceOffset({
      ledger,
      sourceEnd: 15,
    })

    expect(snapshot).toEqual({
      sourceEnd: 15,
      facts: ['林秋已经进入车站'],
      entities: [{ entityType: 'character', entityName: '林秋' }],
    })
  })

  it('collects only events fully contained by a chapter range', () => {
    const events = collectLedgerEventsInRange({
      ledger,
      sourceStart: 10,
      sourceEnd: 35,
    })

    expect(events.map((event) => event.eventId)).toEqual(['event-2'])
  })
})
