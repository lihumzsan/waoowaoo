import { describe, expect, it } from 'vitest'
import { splitEditBibleIntoChapterPlans } from '@/lib/edit-bible/chapter-split'
import { validateEditBibleBundle } from '@/lib/edit-bible/cross-check'
import type { EditBibleBundle } from '@/lib/edit-bible/schemas'

function buildBundle(): EditBibleBundle {
  return {
    bible: {
      title: '旧车站',
      synopsis: '林秋在旧车站追查断电事件。',
      characters: [
        {
          entityId: 'character_lin_qiu',
          name: '林秋',
          aliases: [],
          summary: '追查断电事件的主角',
          voiceProfile: {
            ageImpression: '青年女性声感',
            pitchRange: '中音区偏高',
            timbre: '清亮，边缘柔和不尖锐',
            resonance: '口腔前部共鸣清晰，鼻腔色彩轻',
            vocalWeight: '偏轻声线，声音密度适中',
            texture: '表面干净，几乎无颗粒感',
          },
        },
      ],
      locations: [
        { entityId: 'location_station', name: '旧车站', aliases: [], summary: '核心事件发生地点' },
      ],
      worldRules: [],
      styleGuide: {},
    },
    beatSheet: {
      beats: [
        {
          beatId: 'beat-1',
          title: '进入车站',
          summary: '林秋进入车站。',
          sourceStart: 0,
          sourceEnd: 900,
          estimatedDurationSec: 60,
          persistentFactsIntroduced: ['林秋已经进入车站'],
        },
        {
          beatId: 'beat-2',
          title: '发现断电',
          summary: '车站开始断电。',
          sourceStart: 900,
          sourceEnd: 1800,
          estimatedDurationSec: 60,
          persistentFactsIntroduced: ['旧车站开始断电'],
        },
        {
          beatId: 'beat-3',
          title: '追到站台',
          summary: '林秋追到站台。',
          sourceStart: 1800,
          sourceEnd: 5400,
          estimatedDurationSec: 80,
          persistentFactsIntroduced: ['林秋到达站台'],
        },
      ],
    },
    ledger: {
      events: [
        {
          eventId: 'event-1',
          kind: 'appearance',
          summary: '林秋进入车站。',
          sourceStart: 0,
          sourceEnd: 900,
          entities: [{ entityType: 'character', entityName: '林秋' }],
          persistentFacts: ['林秋已经进入车站'],
        },
        {
          eventId: 'event-2',
          kind: 'location',
          summary: '旧车站开始断电。',
          sourceStart: 900,
          sourceEnd: 1800,
          entities: [{ entityType: 'location', entityName: '旧车站' }],
          persistentFacts: ['旧车站开始断电'],
        },
      ],
    },
    emotionalCurve: {
      cues: [
        {
          cueId: 'cue-1',
          mood: 'suspense',
          intensity: 0.7,
          musicPolicy: 'underscore',
          sourceStart: 0,
          sourceEnd: 1800,
        },
      ],
    },
  }
}

describe('edit bible chapter splitting', () => {
  it('splits ordered beats by adaptive episode duration inside duration and source limits', () => {
    const sourceText = '剧'.repeat(5400)
    const bundle = validateEditBibleBundle({
      bundle: buildBundle(),
      sourceText,
    })

    const chapters = splitEditBibleIntoChapterPlans({ bundle, sourceText })

    expect(chapters).toEqual([
      expect.objectContaining({
        chapterIndex: 0,
        sourceStart: 0,
        sourceEnd: 1800,
        targetDurationSec: 120,
        beatIds: ['beat-1', 'beat-2'],
        eventIds: ['event-1', 'event-2'],
      }),
      expect.objectContaining({
        chapterIndex: 1,
        sourceStart: 1800,
        sourceEnd: 5400,
        targetDurationSec: 80,
        beatIds: ['beat-3'],
      }),
    ])
  })

  it('rejects a single beat that exceeds the chapter source hard limit', () => {
    const sourceText = '剧'.repeat(4000)
    const bundle = buildBundle()
    bundle.beatSheet.beats = [{
      beatId: 'beat-oversized',
      title: '过长章节',
      summary: '这一段太长。',
      sourceStart: 0,
      sourceEnd: 4000,
      estimatedDurationSec: 100,
      persistentFactsIntroduced: [],
    }]

    expect(() => splitEditBibleIntoChapterPlans({
      bundle,
      sourceText,
    })).toThrow('EDIT_BIBLE_BEAT_SOURCE_RANGE_EXCEEDS_CHAPTER_LIMIT')
  })

  it('rejects ledger events that cross chapter boundaries', () => {
    const sourceText = '剧'.repeat(5400)
    const bundle = buildBundle()
    bundle.ledger.events.push({
      eventId: 'event-crossing-cut',
      kind: 'plot',
      summary: '事件跨过第一章切点。',
      sourceStart: 1700,
      sourceEnd: 1900,
      entities: [{ entityType: 'character', entityName: '林秋' }],
      persistentFacts: ['跨界事件不能被双计'],
    })

    expect(() => splitEditBibleIntoChapterPlans({
      bundle,
      sourceText,
    })).toThrow('EDIT_BIBLE_LEDGER_EVENT_NOT_CONTAINED_BY_SINGLE_CHAPTER:event-crossing-cut:0')
  })
})
