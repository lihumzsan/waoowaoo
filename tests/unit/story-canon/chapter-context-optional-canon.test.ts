import { describe, expect, it } from 'vitest'
import {
  compileCreativeChapterContext,
  CreativeContextCompilerError,
} from '@/lib/creative-worker'

const sourceText = 'INT. STATION — NIGHT\nA traveler enters the empty hall.'

function input(eventsJson: unknown = []) {
  return {
    sourceDocument: {
      id: 'source-document',
      normalizedText: sourceText,
    },
    chapter: {
      id: 'chapter-1',
      episodeId: 'episode-1',
      chapterIndex: 0,
      title: 'Arrival',
      summary: 'The traveler enters the station.',
      sourceDocumentId: 'source-document',
      sourceStart: 0,
      sourceEnd: sourceText.length,
      targetDurationSec: 90,
      entrySnapshotJson: { sourceEnd: 0, facts: [], entities: [] },
      eventsJson,
    },
    storyCanonBundle: null,
    referencedAssets: [],
    maxChars: 20_000,
  }
}

describe('Chapter context without a Story Canon prerequisite', () => {
  it('compiles screenplay slice and Chapter identity with empty optional continuity context', () => {
    const result = compileCreativeChapterContext(input())

    expect(result.context.source.text).toBe(sourceText)
    expect(result.context.narrative).toMatchObject({
      beatIds: [],
      beats: [],
      eventIds: [],
      emotionalCues: [],
    })
    expect(result.context.continuity).toEqual({
      storyCanon: null,
      entrySnapshot: { sourceEnd: 0, facts: [], entities: [] },
      events: [],
    })
    expect(result.context).not.toHaveProperty('style')
  })

  it('rejects persisted continuity events when no exact Story Canon context owns them', () => {
    expect(() => compileCreativeChapterContext(input([{
      eventId: 'invented',
      kind: 'plot',
      summary: 'Invented event.',
      sourceStart: 0,
      sourceEnd: 10,
      entities: [],
      persistentFacts: [],
    }]))).toThrowError(CreativeContextCompilerError)
  })
})
