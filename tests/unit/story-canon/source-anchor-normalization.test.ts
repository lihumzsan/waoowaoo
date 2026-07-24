import { describe, expect, it } from 'vitest'
import type { EditSourceBlock } from '@/lib/edit-source-document'
import {
  normalizeRawBeatSheet,
  normalizeRawStoryCanon,
  normalizeRawEmotionalCurve,
  normalizeRawLedger,
} from '@/lib/story-canon/source-anchor-normalization'

const sourceText = '老李启动机器。蓝光照亮地下室。时间开始倒流。'
const blocks: readonly EditSourceBlock[] = [{
  blockId: 'p0001',
  sourceStart: 0,
  sourceEnd: sourceText.length,
  text: sourceText,
}]

describe('story canon source-anchor normalization', () => {
  it('converts raw beat anchors into source ranges for exact optional continuity context', () => {
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
        }],
      },
    })).toThrow()
  })

  it('derives ledger ranges from their bound beats and resolves emotional cue anchors', () => {
    const ledger = normalizeRawLedger({
      beatSheet: {
        beats: [{
          beatId: 'beat_001',
          title: '时间倒流',
          summary: '时间开始倒流。',
          sourceStart: sourceText.indexOf('时间开始'),
          sourceEnd: sourceText.length,
          estimatedDurationSec: 30,
        }],
      },
      raw: {
        events: [{
          eventId: 'event_001',
          beatId: 'beat_001',
          kind: 'plot',
          summary: '时间开始倒流。',
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
    expect(ledger.events[0]).not.toHaveProperty('beatId')
    expect(curve.cues[0]?.sourceEnd).toBe(sourceText.indexOf('倒流。') + '倒流。'.length)
  })

  it('rejects a ledger event that references an unknown beat', () => {
    expect(() => normalizeRawLedger({
      beatSheet: { beats: [] },
      raw: {
        events: [{
          eventId: 'event_001',
          beatId: 'beat_missing',
          kind: 'plot',
          summary: '时间开始倒流。',
          entities: [],
          persistentFacts: [],
        }],
      },
    })).toThrow('STORY_CANON_LEDGER_BEAT_NOT_FOUND:event_001:beat_missing')
  })

  it('normalizes global Story Canon entities without source-position metadata', () => {
    const storyCanon = normalizeRawStoryCanon({
      raw: {
        synopsis: '老李启动机器后，时间开始倒流。',
        characters: [{
          entityId: 'character_lao_li',
          name: '老李',
          aliases: [],
          summary: '启动机器的民间科学家。',
          voiceProfile: '低厚温润带细碎颗粒感的中年男声',
        }],
        locations: [{
          entityId: 'location_basement',
          name: '地下室',
          aliases: [],
          summary: '蓝光出现的空间。',
        }],
        worldRules: ['时间可以开始倒流'],
      },
    })

    expect(storyCanon.characters[0]?.voiceProfile).toBe('低厚温润带细碎颗粒感的中年男声')
    expect(storyCanon.characters[0]).not.toHaveProperty('firstSourceStart')
    expect(storyCanon.locations[0]).not.toHaveProperty('firstSourceStart')
  })
})
