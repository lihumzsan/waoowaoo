import { assertEditSourceRange } from '@/lib/edit-source-document'
import { validateLedgerAgainstSourceText } from '@/lib/edit-ledger'
import { editBibleBundleSchema, type EditBibleBundle } from './schemas'

function normalizeEntityName(value: string): string {
  return value.trim().toLowerCase()
}

function collectBibleEntityNames(bundle: EditBibleBundle): ReadonlySet<string> {
  const names = new Set<string>()
  for (const entity of [...bundle.bible.characters, ...bundle.bible.locations]) {
    names.add(normalizeEntityName(entity.name))
    for (const alias of entity.aliases) names.add(normalizeEntityName(alias))
  }
  for (const rule of bundle.bible.worldRules) names.add(normalizeEntityName(rule))
  return names
}

export function validateEditBibleBundle(input: {
  readonly bundle: unknown
  readonly sourceText: string
}): EditBibleBundle {
  const bundle = editBibleBundleSchema.parse(input.bundle)
  const knownEntities = collectBibleEntityNames(bundle)
  let previousBeatStart = -1
  const beatIds = new Set<string>()
  for (const beat of bundle.beatSheet.beats) {
    assertEditSourceRange(input.sourceText, beat)
    if (beatIds.has(beat.beatId)) {
      throw new Error(`EDIT_BIBLE_BEAT_ID_DUPLICATED:${beat.beatId}`)
    }
    beatIds.add(beat.beatId)
    if (beat.sourceStart < previousBeatStart) {
      throw new Error(`EDIT_BIBLE_BEAT_ORDER_INVALID:${beat.beatId}`)
    }
    previousBeatStart = beat.sourceStart
  }

  const ledger = validateLedgerAgainstSourceText({
    ledger: bundle.ledger,
    sourceText: input.sourceText,
  })
  for (const event of ledger.events) {
    for (const entity of event.entities) {
      if (entity.entityType !== 'character' && entity.entityType !== 'location') continue
      if (!knownEntities.has(normalizeEntityName(entity.entityName))) {
        throw new Error(`EDIT_BIBLE_LEDGER_ENTITY_UNDECLARED:${event.eventId}:${entity.entityName}`)
      }
    }
  }

  for (const cue of bundle.emotionalCurve.cues) {
    assertEditSourceRange(input.sourceText, cue)
  }

  return bundle
}
