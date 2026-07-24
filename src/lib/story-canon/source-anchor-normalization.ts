import { resolveEditSourceAnchor, type EditSourceBlock } from '@/lib/edit-source-document'
import { ledgerSchema, type Ledger } from '@/lib/edit-ledger'
import {
  storyCanonBeatSheetSchema,
  storyCanonEmotionalCurveSchema,
  storyCanonSchema,
  rawStoryCanonBeatSheetSchema,
  rawStoryCanonEmotionalCurveSchema,
  rawStoryCanonLedgerSchema,
  rawStoryCanonSchema,
  type StoryCanon,
  type StoryCanonBeatSheet,
  type StoryCanonEmotionalCurve,
  type RawStoryCanonBeatSheet,
  type RawStoryCanonEmotionalCurve,
  type RawStoryCanonLedger,
} from './schemas'

function omitSourceAnchor<TValue extends { readonly sourceAnchor: unknown }>(
  value: TValue,
): Omit<TValue, 'sourceAnchor'> {
  const { sourceAnchor, ...rest } = value
  void sourceAnchor
  return rest
}

function omitBeatId<TValue extends { readonly beatId: unknown }>(value: TValue): Omit<TValue, 'beatId'> {
  const { beatId, ...rest } = value
  void beatId
  return rest
}

export function normalizeRawStoryCanon(input: {
  readonly raw: unknown
}): StoryCanon {
  const raw = rawStoryCanonSchema.parse(input.raw)
  return storyCanonSchema.parse(raw)
}

export function normalizeRawBeatSheet(input: {
  readonly raw: unknown
  readonly sourceText: string
  readonly blocks: readonly EditSourceBlock[]
}): StoryCanonBeatSheet {
  const raw = rawStoryCanonBeatSheetSchema.parse(input.raw)
  return storyCanonBeatSheetSchema.parse({
    beats: raw.beats.map((beat: RawStoryCanonBeatSheet['beats'][number]) => {
      const range = resolveEditSourceAnchor({
        sourceText: input.sourceText,
        blocks: input.blocks,
        anchor: beat.sourceAnchor,
      })
      return {
        ...omitSourceAnchor(beat),
        ...range,
      }
    }),
  })
}

export function normalizeRawLedger(input: {
  readonly raw: unknown
  readonly beatSheet: StoryCanonBeatSheet
}): Ledger {
  const raw = rawStoryCanonLedgerSchema.parse(input.raw)
  const beatsById = new Map(input.beatSheet.beats.map((beat) => [beat.beatId, beat]))
  return ledgerSchema.parse({
    events: raw.events.map((event: RawStoryCanonLedger['events'][number]) => {
      const beat = beatsById.get(event.beatId)
      if (!beat) throw new Error(`STORY_CANON_LEDGER_BEAT_NOT_FOUND:${event.eventId}:${event.beatId}`)
      return {
        ...omitBeatId(event),
        sourceStart: beat.sourceStart,
        sourceEnd: beat.sourceEnd,
      }
    }),
  })
}

export function normalizeRawEmotionalCurve(input: {
  readonly raw: unknown
  readonly sourceText: string
  readonly blocks: readonly EditSourceBlock[]
}): StoryCanonEmotionalCurve {
  const raw = rawStoryCanonEmotionalCurveSchema.parse(input.raw)
  return storyCanonEmotionalCurveSchema.parse({
    cues: raw.cues.map((cue: RawStoryCanonEmotionalCurve['cues'][number]) => {
      const range = resolveEditSourceAnchor({
        sourceText: input.sourceText,
        blocks: input.blocks,
        anchor: cue.sourceAnchor,
      })
      return {
        ...omitSourceAnchor(cue),
        ...range,
      }
    }),
  })
}
