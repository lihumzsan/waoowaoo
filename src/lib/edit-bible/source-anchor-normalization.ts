import { resolveEditSourceAnchor, type EditSourceBlock } from '@/lib/edit-source-document'
import { ledgerSchema, type Ledger } from '@/lib/edit-ledger'
import {
  editBibleBeatSheetSchema,
  editBibleEmotionalCurveSchema,
  editBibleSchema,
  rawEditBibleBeatSheetSchema,
  rawEditBibleEmotionalCurveSchema,
  rawEditBibleLedgerSchema,
  rawEditBibleSchema,
  type EditBible,
  type EditBibleBeatSheet,
  type EditBibleEmotionalCurve,
  type RawEditBibleBeatSheet,
  type RawEditBibleEmotionalCurve,
  type RawEditBibleLedger,
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

export function normalizeRawEditBible(input: {
  readonly raw: unknown
}): EditBible {
  const raw = rawEditBibleSchema.parse(input.raw)
  return editBibleSchema.parse(raw)
}

export function normalizeRawBeatSheet(input: {
  readonly raw: unknown
  readonly sourceText: string
  readonly blocks: readonly EditSourceBlock[]
}): EditBibleBeatSheet {
  const raw = rawEditBibleBeatSheetSchema.parse(input.raw)
  return editBibleBeatSheetSchema.parse({
    beats: raw.beats.map((beat: RawEditBibleBeatSheet['beats'][number]) => {
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
  readonly beatSheet: EditBibleBeatSheet
}): Ledger {
  const raw = rawEditBibleLedgerSchema.parse(input.raw)
  const beatsById = new Map(input.beatSheet.beats.map((beat) => [beat.beatId, beat]))
  return ledgerSchema.parse({
    events: raw.events.map((event: RawEditBibleLedger['events'][number]) => {
      const beat = beatsById.get(event.beatId)
      if (!beat) throw new Error(`EDIT_BIBLE_LEDGER_BEAT_NOT_FOUND:${event.eventId}:${event.beatId}`)
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
}): EditBibleEmotionalCurve {
  const raw = rawEditBibleEmotionalCurveSchema.parse(input.raw)
  return editBibleEmotionalCurveSchema.parse({
    cues: raw.cues.map((cue: RawEditBibleEmotionalCurve['cues'][number]) => {
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
