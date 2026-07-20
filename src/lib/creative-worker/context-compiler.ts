import { z } from 'zod'
import {
  editBibleBundleSchema,
  editBibleCharacterSchema,
  editBibleEntitySchema,
  editBibleStyleGuideSchema,
} from '@/lib/edit-bible/schemas'
import {
  ledgerEntityRefSchema,
  ledgerEventSchema,
  ledgerSnapshotSchema,
  projectLedgerSnapshotAtSourceOffset,
} from '@/lib/edit-ledger'
import { editScriptStyleBibleSchema } from '@/lib/edit-script/types'

export const CREATIVE_CONTEXT_COMPILER_ERROR_CODES = [
  'CREATIVE_CONTEXT_INPUT_INVALID',
  'CREATIVE_CONTEXT_SOURCE_MISMATCH',
  'CREATIVE_CONTEXT_BIBLE_INCOMPLETE',
  'CREATIVE_CONTEXT_STYLE_BIBLE_REQUIRED',
  'CREATIVE_CONTEXT_CHAPTER_NOT_FOUND',
  'CREATIVE_CONTEXT_RESOURCE_NOT_FOUND',
  'CREATIVE_CONTEXT_RESOURCE_REVISION_CHANGED',
  'CREATIVE_CONTEXT_CHAPTER_RANGE_INVALID',
  'CREATIVE_CONTEXT_BEAT_COVERAGE_INVALID',
  'CREATIVE_CONTEXT_EVENT_MISMATCH',
  'CREATIVE_CONTEXT_SNAPSHOT_MISMATCH',
  'CREATIVE_CONTEXT_ENTITY_AMBIGUOUS',
  'CREATIVE_CONTEXT_ENTITY_MISSING',
  'CREATIVE_CONTEXT_ASSET_CONFLICT',
  'CREATIVE_CONTEXT_BUDGET_EXCEEDED',
] as const

export type CreativeContextCompilerErrorCode =
  (typeof CREATIVE_CONTEXT_COMPILER_ERROR_CODES)[number]

export class CreativeContextCompilerError extends Error {
  readonly code: CreativeContextCompilerErrorCode
  readonly details: Readonly<Record<string, string | number | boolean | null>>

  constructor(
    code: CreativeContextCompilerErrorCode,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
    options?: ErrorOptions,
  ) {
    super(code, options)
    this.name = 'CreativeContextCompilerError'
    this.code = code
    this.details = details
  }
}

const chapterContextSourceSchema = z.object({
  id: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  chapterIndex: z.number().int().min(0),
  title: z.string().trim().min(1).nullable(),
  summary: z.string().trim().min(1).nullable(),
  sourceDocumentId: z.string().trim().min(1).nullable(),
  sourceStart: z.number().int().min(0).nullable(),
  sourceEnd: z.number().int().min(0).nullable(),
  targetDurationSec: z.number().int().positive().nullable(),
  entrySnapshotJson: z.unknown().nullable(),
  eventsJson: z.unknown().nullable(),
}).strict()

const creativeContextAssetSchema = z.object({
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
  mediaType: z.enum(['text', 'image', 'audio', 'video']),
  schemaId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  prompt: z.string().trim().min(1).nullable(),
  mediaId: z.string().trim().min(1).nullable(),
  entityRef: ledgerEntityRefSchema.nullable(),
}).strict()

export const compileCreativeChapterContextInputSchema = z.object({
  sourceDocument: z.object({
    id: z.string().trim().min(1),
    normalizedText: z.string().min(1),
  }).strict(),
  chapter: chapterContextSourceSchema,
  bibleBundle: editBibleBundleSchema,
  styleBible: editScriptStyleBibleSchema.shape.styleBible,
  styleBibleSource: z.object({
    resourceId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    fingerprint: z.string().trim().min(1),
  }).strict(),
  referencedAssets: z.array(creativeContextAssetSchema).max(128),
  maxChars: z.number().int().positive(),
}).strict()

const chapterIdentitySchema = z.object({
  chapterId: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  chapterIndex: z.number().int().min(0),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  targetDurationSec: z.number().int().positive(),
}).strict()

const selectedBibleSchema = z.object({
  title: z.string().trim().min(1).nullable(),
  logline: z.string().trim().min(1).nullable(),
  synopsis: z.string().trim().min(1),
  worldRules: z.array(z.string().trim().min(1)),
  characters: z.array(editBibleCharacterSchema),
  locations: z.array(editBibleEntitySchema),
}).strict()

const compiledChapterContextSchema = z.object({
  kind: z.literal('creative_chapter_context'),
  chapter: chapterIdentitySchema,
  source: z.object({
    sourceDocumentId: z.string().trim().min(1),
    sourceStart: z.number().int().min(0),
    sourceEnd: z.number().int().positive(),
    text: z.string().min(1),
  }).strict(),
  narrative: z.object({
    beatIds: z.array(z.string().trim().min(1)).min(1),
    beats: editBibleBundleSchema.shape.beatSheet.shape.beats,
    eventIds: z.array(z.string().trim().min(1)),
    emotionalCues: editBibleBundleSchema.shape.emotionalCurve.shape.cues,
  }).strict(),
  continuity: z.object({
    bible: selectedBibleSchema,
    entrySnapshot: ledgerSnapshotSchema,
    events: z.array(ledgerEventSchema),
  }).strict(),
  style: z.object({
    storyStyleGuide: editBibleStyleGuideSchema,
    productionStyleBible: editScriptStyleBibleSchema.shape.styleBible,
    source: compileCreativeChapterContextInputSchema.shape.styleBibleSource,
  }).strict(),
  referencedAssets: z.array(creativeContextAssetSchema),
}).strict()

export const compiledCreativeChapterContextResultSchema = z.object({
  context: compiledChapterContextSchema,
  budget: z.object({
    maxChars: z.number().int().positive(),
    serializedChars: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export type CompileCreativeChapterContextInput = z.infer<
  typeof compileCreativeChapterContextInputSchema
>
export type CreativeContextAsset = z.infer<typeof creativeContextAssetSchema>
export type CompiledCreativeChapterContext = z.infer<typeof compiledChapterContextSchema>
export type CompiledCreativeChapterContextResult = z.infer<
  typeof compiledCreativeChapterContextResultSchema
>

function fail(
  code: CreativeContextCompilerErrorCode,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): never {
  throw new CreativeContextCompilerError(code, details)
}

function parseInput(raw: unknown): CompileCreativeChapterContextInput {
  const parsed = compileCreativeChapterContextInputSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  throw new CreativeContextCompilerError(
    'CREATIVE_CONTEXT_INPUT_INVALID',
    { issueCount: parsed.error.issues.length },
    { cause: parsed.error },
  )
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function entityRefKey(ref: z.infer<typeof ledgerEntityRefSchema>): string {
  return `${ref.entityType}:${normalizedName(ref.entityName)}`
}

function assertUniqueIds(
  values: readonly string[],
  code: CreativeContextCompilerErrorCode,
  label: string,
): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) fail(code, { label, duplicateId: value })
    seen.add(value)
  }
}

function normalizedSnapshot(snapshot: z.infer<typeof ledgerSnapshotSchema>) {
  return {
    sourceEnd: snapshot.sourceEnd,
    facts: [...snapshot.facts].sort(),
    entities: [...snapshot.entities]
      .sort((left, right) => entityRefKey(left).localeCompare(entityRefKey(right))),
  }
}

function normalizedEvents(events: readonly z.infer<typeof ledgerEventSchema>[]) {
  return [...events]
    .map((event) => ({
      ...event,
      entities: [...event.entities]
        .sort((left, right) => entityRefKey(left).localeCompare(entityRefKey(right))),
      persistentFacts: [...event.persistentFacts].sort(),
    }))
    .sort((left, right) => left.eventId.localeCompare(right.eventId))
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function overlapsRange(
  item: { readonly sourceStart: number; readonly sourceEnd: number },
  sourceStart: number,
  sourceEnd: number,
): boolean {
  return item.sourceStart < sourceEnd && item.sourceEnd > sourceStart
}

function isContainedByRange(
  item: { readonly sourceStart: number; readonly sourceEnd: number },
  sourceStart: number,
  sourceEnd: number,
): boolean {
  return item.sourceStart >= sourceStart && item.sourceEnd <= sourceEnd
}

function selectRelevantBibleEntities(input: {
  readonly bundle: CompileCreativeChapterContextInput['bibleBundle']
  readonly entityRefs: readonly z.infer<typeof ledgerEntityRefSchema>[]
}) {
  const characterByName = new Map<string, (typeof input.bundle.bible.characters)[number]>()
  const locationByName = new Map<string, (typeof input.bundle.bible.locations)[number]>()

  const register = <TEntity extends {
    readonly entityId: string
    readonly name: string
    readonly aliases: readonly string[]
  }>(
    index: Map<string, TEntity>,
    entity: TEntity,
    entityType: 'character' | 'location',
  ) => {
    for (const candidate of [entity.name, ...entity.aliases]) {
      const key = normalizedName(candidate)
      const existing = index.get(key)
      if (existing && existing.entityId !== entity.entityId) {
        fail('CREATIVE_CONTEXT_ENTITY_AMBIGUOUS', { entityType, entityName: candidate })
      }
      index.set(key, entity)
    }
  }

  for (const character of input.bundle.bible.characters) {
    register(characterByName, character, 'character')
  }
  for (const location of input.bundle.bible.locations) {
    register(locationByName, location, 'location')
  }

  const characters = new Map<string, (typeof input.bundle.bible.characters)[number]>()
  const locations = new Map<string, (typeof input.bundle.bible.locations)[number]>()
  for (const ref of input.entityRefs) {
    if (ref.entityType !== 'character' && ref.entityType !== 'location') continue
    if (ref.entityType === 'character') {
      const character = characterByName.get(normalizedName(ref.entityName))
      if (!character) {
        fail('CREATIVE_CONTEXT_ENTITY_MISSING', {
          entityType: ref.entityType,
          entityName: ref.entityName,
        })
      }
      characters.set(character.entityId, character)
    } else {
      const location = locationByName.get(normalizedName(ref.entityName))
      if (!location) {
        fail('CREATIVE_CONTEXT_ENTITY_MISSING', {
          entityType: ref.entityType,
          entityName: ref.entityName,
        })
      }
      locations.set(location.entityId, location)
    }
  }

  return {
    characters: Array.from(characters.values()),
    locations: Array.from(locations.values()),
  }
}

export function compileCreativeChapterContext(
  raw: unknown,
): CompiledCreativeChapterContextResult {
  const input = parseInput(raw)
  const { chapter, sourceDocument, bibleBundle } = input

  if (chapter.sourceDocumentId !== sourceDocument.id) {
    fail('CREATIVE_CONTEXT_SOURCE_MISMATCH', {
      chapterId: chapter.id,
      chapterSourceDocumentId: chapter.sourceDocumentId,
      sourceDocumentId: sourceDocument.id,
    })
  }
  if (
    chapter.sourceStart === null
    || chapter.sourceEnd === null
    || chapter.targetDurationSec === null
    || chapter.title === null
    || chapter.summary === null
    || chapter.entrySnapshotJson === null
    || chapter.eventsJson === null
    || chapter.sourceEnd <= chapter.sourceStart
    || chapter.sourceEnd > sourceDocument.normalizedText.length
  ) {
    fail('CREATIVE_CONTEXT_CHAPTER_RANGE_INVALID', {
      chapterId: chapter.id,
      sourceLength: sourceDocument.normalizedText.length,
    })
  }
  const sourceStart = chapter.sourceStart
  const sourceEnd = chapter.sourceEnd

  assertUniqueIds(
    bibleBundle.beatSheet.beats.map((beat) => beat.beatId),
    'CREATIVE_CONTEXT_BEAT_COVERAGE_INVALID',
    'beatId',
  )
  assertUniqueIds(
    bibleBundle.ledger.events.map((event) => event.eventId),
    'CREATIVE_CONTEXT_EVENT_MISMATCH',
    'eventId',
  )
  assertUniqueIds(
    input.referencedAssets.map((asset) => asset.resourceId),
    'CREATIVE_CONTEXT_ASSET_CONFLICT',
    'resourceId',
  )

  const overlappingBeats = bibleBundle.beatSheet.beats.filter((beat) => (
    overlapsRange(beat, sourceStart, sourceEnd)
  ))
  const beats = overlappingBeats.filter((beat) => (
    isContainedByRange(beat, sourceStart, sourceEnd)
  ))
  if (beats.length === 0 || beats.length !== overlappingBeats.length) {
    fail('CREATIVE_CONTEXT_BEAT_COVERAGE_INVALID', {
      chapterId: chapter.id,
      overlappingBeatCount: overlappingBeats.length,
      containedBeatCount: beats.length,
    })
  }

  const events = bibleBundle.ledger.events.filter((event) => (
    isContainedByRange(event, sourceStart, sourceEnd)
  ))
  const persistedEventsResult = z.array(ledgerEventSchema).safeParse(chapter.eventsJson)
  if (!persistedEventsResult.success) {
    throw new CreativeContextCompilerError(
      'CREATIVE_CONTEXT_EVENT_MISMATCH',
      { chapterId: chapter.id, issueCount: persistedEventsResult.error.issues.length },
      { cause: persistedEventsResult.error },
    )
  }
  if (!equalJson(normalizedEvents(events), normalizedEvents(persistedEventsResult.data))) {
    fail('CREATIVE_CONTEXT_EVENT_MISMATCH', { chapterId: chapter.id })
  }

  const expectedSnapshot = projectLedgerSnapshotAtSourceOffset({
    ledger: bibleBundle.ledger,
    sourceEnd: sourceStart,
  })
  const persistedSnapshotResult = ledgerSnapshotSchema.safeParse(chapter.entrySnapshotJson)
  if (!persistedSnapshotResult.success) {
    throw new CreativeContextCompilerError(
      'CREATIVE_CONTEXT_SNAPSHOT_MISMATCH',
      { chapterId: chapter.id, issueCount: persistedSnapshotResult.error.issues.length },
      { cause: persistedSnapshotResult.error },
    )
  }
  if (!equalJson(
    normalizedSnapshot(expectedSnapshot),
    normalizedSnapshot(persistedSnapshotResult.data),
  )) {
    fail('CREATIVE_CONTEXT_SNAPSHOT_MISMATCH', { chapterId: chapter.id })
  }

  const chapterEntityRefs = [
    ...expectedSnapshot.entities,
    ...events.flatMap((event) => event.entities),
  ]
  const chapterEntityKeys = new Set(chapterEntityRefs.map(entityRefKey))
  const referencedAssets = input.referencedAssets.filter((asset) => (
    asset.entityRef === null || chapterEntityKeys.has(entityRefKey(asset.entityRef))
  ))
  const selectedEntities = selectRelevantBibleEntities({
    bundle: bibleBundle,
    entityRefs: chapterEntityRefs,
  })
  const emotionalCues = bibleBundle.emotionalCurve.cues.filter((cue) => (
    overlapsRange(cue, sourceStart, sourceEnd)
  ))
  const sourceText = sourceDocument.normalizedText.slice(sourceStart, sourceEnd)
  if (!sourceText.trim()) {
    fail('CREATIVE_CONTEXT_CHAPTER_RANGE_INVALID', {
      chapterId: chapter.id,
      sourceStart,
      sourceEnd,
    })
  }

  const context = compiledChapterContextSchema.parse({
    kind: 'creative_chapter_context',
    chapter: {
      chapterId: chapter.id,
      episodeId: chapter.episodeId,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      summary: chapter.summary,
      targetDurationSec: chapter.targetDurationSec,
    },
    source: {
      sourceDocumentId: sourceDocument.id,
      sourceStart,
      sourceEnd,
      text: sourceText,
    },
    narrative: {
      beatIds: beats.map((beat) => beat.beatId),
      beats,
      eventIds: events.map((event) => event.eventId),
      emotionalCues,
    },
    continuity: {
      bible: {
        title: bibleBundle.bible.title ?? null,
        logline: bibleBundle.bible.logline ?? null,
        synopsis: bibleBundle.bible.synopsis,
        worldRules: bibleBundle.bible.worldRules,
        characters: selectedEntities.characters,
        locations: selectedEntities.locations,
      },
      entrySnapshot: expectedSnapshot,
      events,
    },
    style: {
      storyStyleGuide: bibleBundle.bible.styleGuide,
      productionStyleBible: input.styleBible,
      source: input.styleBibleSource,
    },
    referencedAssets,
  })
  const serializedChars = JSON.stringify(context).length
  if (serializedChars > input.maxChars) {
    fail('CREATIVE_CONTEXT_BUDGET_EXCEEDED', {
      chapterId: chapter.id,
      serializedChars,
      maxChars: input.maxChars,
    })
  }

  return compiledCreativeChapterContextResultSchema.parse({
    context,
    budget: {
      maxChars: input.maxChars,
      serializedChars,
    },
  })
}
