import { describe, expect, it } from 'vitest'
import type { EditSourceBlock } from '@/lib/edit-source-document'
import {
  normalizeRawBeatSheet,
  normalizeRawEditBible,
  normalizeRawEmotionalCurve,
  normalizeRawLedger,
} from '@/lib/edit-bible/source-anchor-normalization'

const sourceText = '老李启动机器。蓝光照亮地下室。时间开始倒流。'
const blocks: readonly EditSourceBlock[] = [{
  blockId: 'p0001',
  sourceStart: 0,
  sourceEnd: sourceText.length,
  text: sourceText,
}]

describe('edit bible source-anchor normalization', () => {
  it('converts raw beat anchors into source ranges before downstream chapter splitting', () => {
    const beatSheet = normalizeRawBeatSheet({
      sourceText,
      blocks,
      raw: {
        beats: [{
          beatId: 'beat_001',
          title: '蓝光出现',
          summary: '蓝光照亮地下室。',
          sourceAnchor: {
            startBlockId: 'p0001',
            startQuote: '蓝光照亮',
            endBlockId: 'p0001',
            endQuote: '地下室。',
          },
          estimatedDurationSec: 30,
          persistentFactsIntroduced: ['地下室被蓝光照亮'],
        }],
      },
    })

    expect(beatSheet.beats[0]).toEqual(expect.objectContaining({
      sourceStart: sourceText.indexOf('蓝光照亮'),
      sourceEnd: sourceText.indexOf('地下室。') + '地下室。'.length,
    }))
    expect(beatSheet.beats[0]).not.toHaveProperty('sourceAnchor')
  })

  it('rejects model beat output that still tries to provide numeric offsets', () => {
    expect(() => normalizeRawBeatSheet({
      sourceText,
      blocks,
      raw: {
        beats: [{
          beatId: 'beat_001',
          title: '错误旧格式',
          summary: '模型仍在数下标。',
          sourceStart: 0,
          sourceEnd: 999,
          estimatedDurationSec: 30,
          persistentFactsIntroduced: [],
        }],
      },
    })).toThrow()
  })

  it('converts ledger and emotional cue anchors through the same resolver', () => {
    const ledger = normalizeRawLedger({
      sourceText,
      blocks,
      raw: {
        events: [{
          eventId: 'event_001',
          kind: 'plot',
          summary: '时间开始倒流。',
          sourceAnchor: {
            startBlockId: 'p0001',
            startQuote: '时间开始',
            endBlockId: 'p0001',
            endQuote: '倒流。',
          },
          entities: [{ entityType: 'world', entityName: '时间' }],
          persistentFacts: ['时间已经开始倒流'],
        }],
      },
    })
    const curve = normalizeRawEmotionalCurve({
      sourceText,
      blocks,
      raw: {
        cues: [{
          cueId: 'cue_001',
          mood: '异常升级',
          intensity: 0.8,
          musicPolicy: 'underscore',
          sourceAnchor: {
            startBlockId: 'p0001',
            startQuote: '蓝光照亮',
            endBlockId: 'p0001',
            endQuote: '倒流。',
          },
        }],
      },
    })

    expect(ledger.events[0]?.sourceStart).toBe(sourceText.indexOf('时间开始'))
    expect(curve.cues[0]?.sourceEnd).toBe(sourceText.indexOf('倒流。') + '倒流。'.length)
  })

  it('converts global bible firstEvidence into firstSourceStart', () => {
    const bible = normalizeRawEditBible({
      sourceText,
      blocks,
      raw: {
        synopsis: '老李启动机器后，时间开始倒流。',
        characters: [{
          entityId: 'character_lao_li',
          name: '老李',
          aliases: [],
          summary: '启动机器的民间科学家。',
          voiceProfile: '偏低略沙哑的中年男声，语速急促但吐字清楚。',
          firstEvidence: { blockId: 'p0001', quote: '老李' },
        }],
        locations: [{
          entityId: 'location_basement',
          name: '地下室',
          aliases: [],
          summary: '蓝光出现的空间。',
          firstEvidence: { blockId: 'p0001', quote: '地下室' },
        }],
        worldRules: ['时间可以开始倒流'],
        styleGuide: {},
      },
    })

    expect(bible.characters[0]?.firstSourceStart).toBe(sourceText.indexOf('老李'))
    expect(bible.characters[0]?.voiceProfile).toBe('偏低略沙哑的中年男声，语速急促但吐字清楚。')
    expect(bible.locations[0]?.firstSourceStart).toBe(sourceText.indexOf('地下室'))
  })
})
