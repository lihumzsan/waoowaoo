import { assertEditSourceRange } from '@/lib/edit-source-document'
import { validateLedgerAgainstSourceText } from '@/lib/edit-ledger'
import {
  storyCanonBeatSheetSchema,
  storyCanonBundleSchema,
  storyCanonEmotionalCurveSchema,
  type StoryCanonBeatSheet,
  type StoryCanonBundle,
  type StoryCanonEmotionalCurve,
} from './schemas'

function normalizeEntityName(value: string): string {
  return value.trim().toLowerCase()
}

function collectStoryCanonEntityNames(bundle: StoryCanonBundle): ReadonlySet<string> {
  const names = new Set<string>()
  for (const entity of [...bundle.storyCanon.characters, ...bundle.storyCanon.locations]) {
    names.add(normalizeEntityName(entity.name))
    for (const alias of entity.aliases) names.add(normalizeEntityName(alias))
  }
  for (const rule of bundle.storyCanon.worldRules) names.add(normalizeEntityName(rule))
  return names
}

export function validateStoryCanonBundle(input: {
  readonly bundle: unknown
  readonly sourceText: string
}): StoryCanonBundle {
  const bundle = storyCanonBundleSchema.parse(input.bundle)
  const knownEntities = collectStoryCanonEntityNames(bundle)
  const beatSheet = validateStoryCanonBeatSheetAgainstSourceText({
    beatSheet: bundle.beatSheet,
    sourceText: input.sourceText,
  })
  const ledger = validateLedgerAgainstSourceText({
    ledger: bundle.ledger,
    sourceText: input.sourceText,
  })
  const emotionalCurve = validateStoryCanonEmotionalCurveAgainstSourceText({
    emotionalCurve: bundle.emotionalCurve,
    sourceText: input.sourceText,
  })
  for (const event of ledger.events) {
    for (const entity of event.entities) {
      if (entity.entityType !== 'character' && entity.entityType !== 'location') continue
      if (!knownEntities.has(normalizeEntityName(entity.entityName))) {
        throw new Error(`STORY_CANON_LEDGER_ENTITY_UNDECLARED:${event.eventId}:${entity.entityName}`)
      }
    }
  }

  return {
    ...bundle,
    beatSheet,
    ledger,
    emotionalCurve,
  }
}

export function validateStoryCanonBeatSheetAgainstSourceText(input: {
  readonly beatSheet: unknown
  readonly sourceText: string
}): StoryCanonBeatSheet {
  const beatSheet = storyCanonBeatSheetSchema.parse(input.beatSheet)
  let previousBeatStart = -1
  const beatIds = new Set<string>()
  for (const beat of beatSheet.beats) {
    assertEditSourceRange(input.sourceText, beat)
    if (beatIds.has(beat.beatId)) {
      throw new Error(`STORY_CANON_BEAT_ID_DUPLICATED:${beat.beatId}`)
    }
    beatIds.add(beat.beatId)
    if (beat.sourceStart < previousBeatStart) {
      throw new Error(`STORY_CANON_BEAT_ORDER_INVALID:${beat.beatId}`)
    }
    previousBeatStart = beat.sourceStart
  }
  return beatSheet
}

export function validateStoryCanonEmotionalCurveAgainstSourceText(input: {
  readonly emotionalCurve: unknown
  readonly sourceText: string
}): StoryCanonEmotionalCurve {
  const emotionalCurve = storyCanonEmotionalCurveSchema.parse(input.emotionalCurve)
  for (const cue of emotionalCurve.cues) {
    assertEditSourceRange(input.sourceText, cue)
  }
  return emotionalCurve
}
