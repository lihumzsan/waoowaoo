import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import {
  collectLedgerEventsInRange,
  projectLedgerSnapshotAtSourceOffset,
} from '@/lib/edit-ledger'
import { readEpisodeSourceDocumentById } from '@/lib/edit-source-document'
import { EDIT_BIBLE_STATUS, type EditBibleStatus } from './constraints'
import { validateEditBibleBundle } from './cross-check'
import { assertEditBibleCanBeRevised, assertEditBibleReadyForConfirmation } from './lock'
import { splitEditBibleIntoChapterPlans } from './chapter-split'
import { getSignedUrl } from '@/lib/storage'
import {
  editScriptStyleBibleSchema,
  editStylePreviewKeySchema,
  type EditScriptStyleBible,
  type EditScriptVideoRatio,
  type EditStylePreviewKey,
  type EditStylePreviewPayload,
  type EditStylePreviewStatus,
} from '@/lib/edit-script/types'
import {
  editBibleBeatSheetSchema,
  editBibleBundleSchema,
  editBibleEmotionalCurveSchema,
  editBibleSchema,
  type EditBible,
  type EditBibleBeatSheet,
  type EditBibleBundle,
  type EditBibleChapterPlan,
  type EditBibleDiagnostics,
  type EditBibleEmotionalCurve,
} from './schemas'
import { ledgerSchema, type Ledger } from '@/lib/edit-ledger'

type PrismaClientLike = typeof prisma | Prisma.TransactionClient

function normalizeBibleAssetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function bibleAssetNameKey(name: string): string {
  return normalizeBibleAssetName(name).toLocaleLowerCase()
}

async function ensureEditBibleAssets(input: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly bible: EditBible
}): Promise<void> {
  const existingCharacters = await input.tx.projectCharacter.findMany({
    where: { projectId: input.projectId },
    select: { name: true },
  })
  const existingCharacterNames = new Set(existingCharacters.map((character) => bibleAssetNameKey(character.name)))
  for (const character of input.bible.characters) {
    const name = normalizeBibleAssetName(character.name)
    if (!name || existingCharacterNames.has(bibleAssetNameKey(name))) continue
    await input.tx.projectCharacter.create({
      data: {
        projectId: input.projectId,
        name,
        aliases: character.aliases.length > 0 ? JSON.stringify(character.aliases) : null,
        profileData: character.summary,
        profileConfirmed: false,
        introduction: character.summary,
        appearances: {
          create: {
            appearanceIndex: PRIMARY_APPEARANCE_INDEX,
            changeReason: 'edit_bible',
            description: character.summary,
            descriptions: JSON.stringify([character.summary]),
            imageUrls: encodeImageUrls([]),
            previousImageUrls: encodeImageUrls([]),
          },
        },
      },
    })
    existingCharacterNames.add(bibleAssetNameKey(name))
  }

  const existingLocations = await input.tx.projectLocation.findMany({
    where: { projectId: input.projectId, assetKind: 'location' },
    select: { name: true },
  })
  const existingLocationNames = new Set(existingLocations.map((location) => bibleAssetNameKey(location.name)))
  for (const location of input.bible.locations) {
    const name = normalizeBibleAssetName(location.name)
    if (!name || existingLocationNames.has(bibleAssetNameKey(name))) continue
    await input.tx.projectLocation.create({
      data: {
        projectId: input.projectId,
        name,
        summary: location.summary,
        assetKind: 'location',
        images: {
          create: {
            imageIndex: 0,
            description: location.summary,
          },
        },
      },
    })
    existingLocationNames.add(bibleAssetNameKey(name))
  }
}

interface PersistedBibleSnapshot {
  readonly id: string
  readonly sourceDocumentId: string
  readonly bibleJson: Prisma.JsonValue | null
  readonly beatSheetJson: Prisma.JsonValue | null
  readonly ledgerJson: Prisma.JsonValue | null
  readonly emotionalCurveJson: Prisma.JsonValue | null
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly diagnosticsJson: Prisma.JsonValue | null
  readonly version: number
  readonly status: string
  readonly lockedAt: Date | null
}

interface PersistedBibleStylePreview {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly editBibleId: string
  readonly styleKey: string
  readonly aspectRatio: string
  readonly title: string
  readonly summary: string
  readonly styleBibleJson: Prisma.JsonValue
  readonly imagePrompt: string
  readonly imageKey: string | null
  readonly status: string
  readonly taskId: string | null
  readonly errorMessage: string | null
}

export interface EditBibleGenerationTarget {
  readonly editBibleId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly version: number
  readonly rollback: () => Promise<void>
}

export interface PersistedEditBibleBundle {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly version: number
  readonly status: EditBibleStatus
  readonly lockedAt: Date | null
  readonly bible: EditBible | null
  readonly beatSheet: EditBibleBeatSheet | null
  readonly ledger: Ledger | null
  readonly emotionalCurve: EditBibleEmotionalCurve | null
  readonly styleBible: EditScriptStyleBible | null
  readonly stylePreviews: readonly EditStylePreviewPayload[]
  readonly diagnostics: EditBibleDiagnostics | null
}

export interface PersistedEditChapterPlan extends EditBibleChapterPlan {
  readonly id: string
  readonly status: string
  readonly renderStatus: string | null
  readonly outputMediaId: string | null
}

const persistedBibleSelect = {
  id: true,
  episodeId: true,
  sourceDocumentId: true,
  bibleJson: true,
  beatSheetJson: true,
  ledgerJson: true,
  emotionalCurveJson: true,
  styleBibleJson: true,
  diagnosticsJson: true,
  version: true,
  status: true,
  lockedAt: true,
  stylePreviews: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      projectId: true,
      episodeId: true,
      editBibleId: true,
      styleKey: true,
      aspectRatio: true,
      title: true,
      summary: true,
      styleBibleJson: true,
      imagePrompt: true,
      imageKey: true,
      status: true,
      taskId: true,
      errorMessage: true,
    },
  },
} as const

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function toNullableInputJsonValue(value: unknown | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : toInputJsonValue(value)
}

function normalizeBibleStatus(value: string): EditBibleStatus {
  if (
    value === EDIT_BIBLE_STATUS.PENDING
    || value === EDIT_BIBLE_STATUS.GENERATING
    || value === EDIT_BIBLE_STATUS.READY_FOR_REVIEW
    || value === EDIT_BIBLE_STATUS.CONFIRMED
    || value === EDIT_BIBLE_STATUS.FAILED
  ) {
    return value
  }
  throw new Error(`EDIT_BIBLE_STATUS_INVALID:${value}`)
}

function parseBundlePart<TData>(value: Prisma.JsonValue | null, parse: (value: unknown) => TData): TData | null {
  return value === null ? null : parse(value)
}

function parseOptionalStyleBibleJson(value: Prisma.JsonValue | null): EditScriptStyleBible | null {
  if (value === null) return null
  const parsed = editScriptStyleBibleSchema.safeParse({ styleBible: value })
  if (!parsed.success) {
    throw new Error('EDIT_BIBLE_STYLE_BIBLE_INVALID')
  }
  return parsed.data.styleBible
}

function parseRequiredStyleBibleJson(value: Prisma.JsonValue): EditScriptStyleBible {
  const parsed = editScriptStyleBibleSchema.safeParse({ styleBible: value })
  if (!parsed.success) {
    throw new Error('EDIT_STYLE_PREVIEW_STYLE_BIBLE_INVALID')
  }
  return parsed.data.styleBible
}

function normalizeStylePreviewStatus(value: string): EditStylePreviewStatus {
  if (value === 'generating' || value === 'completed' || value === 'confirmed' || value === 'failed') return value
  return 'pending'
}

function normalizeStylePreviewKey(value: string): EditStylePreviewKey {
  const parsed = editStylePreviewKeySchema.safeParse(value)
  if (!parsed.success) throw new Error(`EDIT_STYLE_PREVIEW_KEY_INVALID:${value}`)
  return parsed.data as EditStylePreviewKey
}

function normalizeStylePreviewAspectRatio(value: string): EditScriptVideoRatio {
  if (value === '9:16' || value === '16:9' || value === '21:9') return value
  throw new Error(`EDIT_STYLE_PREVIEW_ASPECT_RATIO_INVALID:${value}`)
}

function mapPersistedStylePreview(preview: PersistedBibleStylePreview): EditStylePreviewPayload {
  return {
    id: preview.id,
    projectId: preview.projectId,
    episodeId: preview.episodeId,
    bibleId: preview.editBibleId,
    styleKey: normalizeStylePreviewKey(preview.styleKey),
    aspectRatio: normalizeStylePreviewAspectRatio(preview.aspectRatio),
    title: preview.title,
    summary: preview.summary,
    styleBible: parseRequiredStyleBibleJson(preview.styleBibleJson),
    gridImagePrompt: preview.imagePrompt,
    imageKey: preview.imageKey,
    imageUrl: preview.imageKey ? getSignedUrl(preview.imageKey, 7 * 24 * 3600) : null,
    status: normalizeStylePreviewStatus(preview.status),
    taskId: preview.taskId,
    errorMessage: preview.errorMessage,
  }
}

function mapPersistedBible(record: {
  readonly id: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly bibleJson: Prisma.JsonValue | null
  readonly beatSheetJson: Prisma.JsonValue | null
  readonly ledgerJson: Prisma.JsonValue | null
  readonly emotionalCurveJson: Prisma.JsonValue | null
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly diagnosticsJson: Prisma.JsonValue | null
  readonly version: number
  readonly status: string
  readonly lockedAt: Date | null
  readonly stylePreviews?: readonly PersistedBibleStylePreview[]
}, projectId: string): PersistedEditBibleBundle {
  const diagnostics = record.diagnosticsJson && typeof record.diagnosticsJson === 'object'
    ? record.diagnosticsJson as EditBibleDiagnostics
    : null
  return {
    id: record.id,
    projectId,
    episodeId: record.episodeId,
    sourceDocumentId: record.sourceDocumentId,
    version: record.version,
    status: normalizeBibleStatus(record.status),
    lockedAt: record.lockedAt,
    bible: parseBundlePart(record.bibleJson, (value) => editBibleSchema.parse(value)),
    beatSheet: parseBundlePart(record.beatSheetJson, (value) => editBibleBeatSheetSchema.parse(value)),
    ledger: parseBundlePart(record.ledgerJson, (value) => ledgerSchema.parse(value)),
    emotionalCurve: parseBundlePart(record.emotionalCurveJson, (value) => editBibleEmotionalCurveSchema.parse(value)),
    styleBible: parseOptionalStyleBibleJson(record.styleBibleJson),
    stylePreviews: (record.stylePreviews ?? []).map(mapPersistedStylePreview),
    diagnostics,
  }
}

async function assertEpisodeAccess(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly client: PrismaClientLike
}) {
  const episode = await input.client.projectEpisode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: { id: true },
  })
  if (!episode) throw new ApiError('NOT_FOUND')
}

async function restoreBibleSnapshot(input: {
  readonly editBibleId: string
  readonly snapshot: PersistedBibleSnapshot | null
}) {
  if (!input.snapshot) {
    await prisma.projectEditBible.deleteMany({ where: { id: input.editBibleId } })
    return
  }
  await prisma.projectEditBible.update({
    where: { id: input.snapshot.id },
    data: {
      sourceDocumentId: input.snapshot.sourceDocumentId,
      bibleJson: toNullableInputJsonValue(input.snapshot.bibleJson),
      beatSheetJson: toNullableInputJsonValue(input.snapshot.beatSheetJson),
      ledgerJson: toNullableInputJsonValue(input.snapshot.ledgerJson),
      emotionalCurveJson: toNullableInputJsonValue(input.snapshot.emotionalCurveJson),
      styleBibleJson: toNullableInputJsonValue(input.snapshot.styleBibleJson),
      diagnosticsJson: toNullableInputJsonValue(input.snapshot.diagnosticsJson),
      version: input.snapshot.version,
      status: input.snapshot.status,
      lockedAt: input.snapshot.lockedAt,
    },
  })
}

export async function prepareEditBibleGenerationTarget(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
}): Promise<EditBibleGenerationTarget> {
  const target = await prisma.$transaction(async (tx) => {
    await assertEpisodeAccess({ ...input, client: tx })
    const sourceDocument = await tx.projectEpisodeSourceDocument.findFirst({
      where: {
        id: input.sourceDocumentId,
        episodeId: input.episodeId,
      },
      select: { id: true },
    })
    if (!sourceDocument) throw new ApiError('NOT_FOUND')

    const snapshot = await tx.projectEditBible.findUnique({
      where: { episodeId: input.episodeId },
      select: persistedBibleSelect,
    })
    if (snapshot) {
      assertEditBibleCanBeRevised({
        status: snapshot.status,
        lockedAt: snapshot.lockedAt,
      })
    }

    const version = (snapshot?.version ?? 0) + 1
    const bible = snapshot
      ? await tx.projectEditBible.update({
          where: { id: snapshot.id },
          data: {
            sourceDocumentId: input.sourceDocumentId,
            bibleJson: Prisma.JsonNull,
            beatSheetJson: Prisma.JsonNull,
            ledgerJson: Prisma.JsonNull,
            emotionalCurveJson: Prisma.JsonNull,
            styleBibleJson: Prisma.JsonNull,
            diagnosticsJson: Prisma.JsonNull,
            version,
            status: EDIT_BIBLE_STATUS.GENERATING,
            lockedAt: null,
          },
          select: { id: true },
        })
      : await tx.projectEditBible.create({
          data: {
            episodeId: input.episodeId,
            sourceDocumentId: input.sourceDocumentId,
            version,
            status: EDIT_BIBLE_STATUS.GENERATING,
          },
          select: { id: true },
        })

    return {
      editBibleId: bible.id,
      version,
      snapshot,
    }
  })

  return {
    editBibleId: target.editBibleId,
    episodeId: input.episodeId,
    sourceDocumentId: input.sourceDocumentId,
    version: target.version,
    rollback: async () => await restoreBibleSnapshot({
      editBibleId: target.editBibleId,
      snapshot: target.snapshot,
    }),
  }
}

async function assertNoDownstreamChapterArtifacts(input: {
  readonly episodeId: string
  readonly client: PrismaClientLike
}) {
  const chapter = await input.client.projectEditChapter.findFirst({
    where: {
      episodeId: input.episodeId,
      OR: [
        { editScript: { isNot: null } },
        { shotExecutionPlan: { isNot: null } },
        { storyboards: { some: {} } },
        { requirements: { some: {} } },
        { videoGroups: { some: {} } },
      ],
    },
    select: { id: true, chapterIndex: true },
  })
  if (chapter) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_CHAPTER_REPLACEMENT_BLOCKED_BY_DOWNSTREAM_ARTIFACTS',
      message: `Chapter ${String(chapter.chapterIndex)} already has downstream edit artifacts.`,
    })
  }
}

async function writeChapterPlans(input: {
  readonly tx: Prisma.TransactionClient
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly bibleVersion: number
  readonly bundle: EditBibleBundle
  readonly plans: readonly EditBibleChapterPlan[]
}): Promise<readonly PersistedEditChapterPlan[]> {
  const planIndexes = input.plans.map((plan) => plan.chapterIndex)
  if (planIndexes.length === 0) throw new Error('EDIT_BIBLE_CHAPTER_PLANS_EMPTY')
  await input.tx.projectEditChapter.deleteMany({
    where: {
      episodeId: input.episodeId,
      chapterIndex: { notIn: planIndexes },
    },
  })

  const chapters: PersistedEditChapterPlan[] = []
  for (const plan of input.plans) {
    const events = collectLedgerEventsInRange({
      ledger: input.bundle.ledger,
      sourceStart: plan.sourceStart,
      sourceEnd: plan.sourceEnd,
    })
    const entrySnapshot = projectLedgerSnapshotAtSourceOffset({
      ledger: input.bundle.ledger,
      sourceEnd: plan.sourceStart,
    })
    const record = await input.tx.projectEditChapter.upsert({
      where: {
        episodeId_chapterIndex: {
          episodeId: input.episodeId,
          chapterIndex: plan.chapterIndex,
        },
      },
      create: {
        episodeId: input.episodeId,
        chapterIndex: plan.chapterIndex,
        title: plan.title,
        summary: plan.summary,
        sourceDocumentId: input.sourceDocumentId,
        sourceStart: plan.sourceStart,
        sourceEnd: plan.sourceEnd,
        targetDurationSec: plan.targetDurationSec,
        entrySnapshotJson: toInputJsonValue(entrySnapshot),
        eventsJson: toInputJsonValue(events),
        provenanceJson: toInputJsonValue({
          sourceDocumentId: input.sourceDocumentId,
          bibleVersion: input.bibleVersion,
          beatIds: plan.beatIds,
          eventIds: plan.eventIds,
        }),
        status: 'ready',
      },
      update: {
        title: plan.title,
        summary: plan.summary,
        sourceDocumentId: input.sourceDocumentId,
        sourceStart: plan.sourceStart,
        sourceEnd: plan.sourceEnd,
        targetDurationSec: plan.targetDurationSec,
        entrySnapshotJson: toInputJsonValue(entrySnapshot),
        eventsJson: toInputJsonValue(events),
        provenanceJson: toInputJsonValue({
          sourceDocumentId: input.sourceDocumentId,
          bibleVersion: input.bibleVersion,
          beatIds: plan.beatIds,
          eventIds: plan.eventIds,
        }),
        status: 'ready',
      },
      select: {
        id: true,
        status: true,
        renderStatus: true,
        outputMediaId: true,
      },
    })
    chapters.push({
      ...plan,
      id: record.id,
      status: record.status,
      renderStatus: record.renderStatus,
      outputMediaId: record.outputMediaId,
    })
  }
  return chapters
}

export async function persistGeneratedEditBibleBundle(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editBibleId: string
  readonly sourceDocumentId: string
  readonly bundle: EditBibleBundle
}): Promise<{
  readonly editBible: PersistedEditBibleBundle
  readonly chapters: readonly PersistedEditChapterPlan[]
}> {
  const sourceDocument = await readEpisodeSourceDocumentById({
    projectId: input.projectId,
    episodeId: input.episodeId,
    sourceDocumentId: input.sourceDocumentId,
  })
  const bundle = validateEditBibleBundle({
    bundle: input.bundle,
    sourceText: sourceDocument.normalizedText,
  })
  const plans = splitEditBibleIntoChapterPlans({
    bundle,
    sourceText: sourceDocument.normalizedText,
  })

  return await prisma.$transaction(async (tx) => {
    const bible = await tx.projectEditBible.findFirst({
      where: {
        id: input.editBibleId,
        episodeId: input.episodeId,
        sourceDocumentId: input.sourceDocumentId,
      },
      select: persistedBibleSelect,
    })
    if (!bible) throw new ApiError('NOT_FOUND')
    if (bible.status !== EDIT_BIBLE_STATUS.GENERATING) {
      throw new Error(`EDIT_BIBLE_GENERATION_STATUS_INVALID:${bible.status}`)
    }

    await assertNoDownstreamChapterArtifacts({
      episodeId: input.episodeId,
      client: tx,
    })
    const chapters = await writeChapterPlans({
      tx,
      episodeId: input.episodeId,
      sourceDocumentId: input.sourceDocumentId,
      bibleVersion: bible.version,
      bundle,
      plans,
    })
    await tx.projectEditStylePreview.deleteMany({
      where: { editBibleId: bible.id },
    })
    const updated = await tx.projectEditBible.update({
      where: { id: bible.id },
      data: {
        bibleJson: toInputJsonValue(bundle.bible),
        beatSheetJson: toInputJsonValue(bundle.beatSheet),
        ledgerJson: toInputJsonValue(bundle.ledger),
        emotionalCurveJson: toInputJsonValue(bundle.emotionalCurve),
        styleBibleJson: Prisma.JsonNull,
        diagnosticsJson: Prisma.JsonNull,
        status: EDIT_BIBLE_STATUS.READY_FOR_REVIEW,
      },
      select: persistedBibleSelect,
    })
    return {
      editBible: mapPersistedBible(updated, input.projectId),
      chapters,
    }
  })
}

export async function markEditBibleGenerationFailed(input: {
  readonly editBibleId: string
  readonly diagnostics: EditBibleDiagnostics
}) {
  await prisma.projectEditBible.updateMany({
    where: { id: input.editBibleId },
    data: {
      status: EDIT_BIBLE_STATUS.FAILED,
      diagnosticsJson: toInputJsonValue(input.diagnostics),
    },
  })
}

export async function readEpisodeEditBible(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<PersistedEditBibleBundle | null> {
  const record = await prisma.projectEditBible.findFirst({
    where: {
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
    },
    select: persistedBibleSelect,
  })
  return record ? mapPersistedBible(record, input.projectId) : null
}

export async function readEpisodeEditChapters(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<readonly PersistedEditChapterPlan[]> {
  const chapters = await prisma.projectEditChapter.findMany({
    where: {
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
      sourceStart: { not: null },
      sourceEnd: { not: null },
      targetDurationSec: { not: null },
    },
    orderBy: { chapterIndex: 'asc' },
    select: {
      id: true,
      chapterIndex: true,
      title: true,
      summary: true,
      sourceStart: true,
      sourceEnd: true,
      targetDurationSec: true,
      provenanceJson: true,
      eventsJson: true,
      renderStatus: true,
      outputMediaId: true,
      status: true,
    },
  })
  return chapters.map((chapter) => {
    if (
      chapter.sourceStart === null
      || chapter.sourceEnd === null
      || chapter.targetDurationSec === null
      || !chapter.title
      || !chapter.summary
    ) {
      throw new Error(`EDIT_CHAPTER_SOURCE_PLAN_INCOMPLETE:${chapter.id}`)
    }
    const provenance = chapter.provenanceJson && typeof chapter.provenanceJson === 'object'
      ? chapter.provenanceJson as { beatIds?: unknown; eventIds?: unknown }
      : {}
    const beatIds = Array.isArray(provenance.beatIds)
      ? provenance.beatIds.filter((value): value is string => typeof value === 'string')
      : []
    const eventIds = Array.isArray(provenance.eventIds)
      ? provenance.eventIds.filter((value): value is string => typeof value === 'string')
      : []
    return {
      id: chapter.id,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      summary: chapter.summary,
      sourceStart: chapter.sourceStart,
      sourceEnd: chapter.sourceEnd,
      targetDurationSec: chapter.targetDurationSec,
      beatIds,
      eventIds,
      status: chapter.status,
      renderStatus: chapter.renderStatus,
      outputMediaId: chapter.outputMediaId,
    }
  })
}

export async function confirmEpisodeEditBible(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
}): Promise<PersistedEditBibleBundle> {
  return await prisma.$transaction(async (tx) => {
    await assertEpisodeAccess({ ...input, client: tx })
    const bible = await tx.projectEditBible.findUnique({
      where: { episodeId: input.episodeId },
      select: persistedBibleSelect,
    })
    if (!bible) throw new ApiError('NOT_FOUND')
    assertEditBibleReadyForConfirmation({ status: bible.status })
    const chapterCount = await tx.projectEditChapter.count({
      where: {
        episodeId: input.episodeId,
        sourceDocumentId: bible.sourceDocumentId,
      },
    })
    if (chapterCount < 1) {
      throw new Error('EDIT_BIBLE_CONFIRMATION_REQUIRES_CHAPTERS')
    }
    const parsedBible = editBibleSchema.parse(bible.bibleJson)
    await ensureEditBibleAssets({
      tx,
      projectId: input.projectId,
      bible: parsedBible,
    })
    const updated = await tx.projectEditBible.update({
      where: { id: bible.id },
      data: {
        status: EDIT_BIBLE_STATUS.CONFIRMED,
        lockedAt: new Date(),
      },
      select: persistedBibleSelect,
    })
    return mapPersistedBible(updated, input.projectId)
  })
}

export async function reviseEpisodeEditBible(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly patch: {
    readonly bible?: EditBible
    readonly beatSheet?: EditBibleBeatSheet
    readonly ledger?: Ledger
    readonly emotionalCurve?: EditBibleEmotionalCurve
  }
}): Promise<{
  readonly editBible: PersistedEditBibleBundle
  readonly chapters: readonly PersistedEditChapterPlan[]
}> {
  const existing = await readEpisodeEditBible({
    projectId: input.projectId,
    episodeId: input.episodeId,
  })
  if (!existing) throw new ApiError('NOT_FOUND')
  assertEditBibleCanBeRevised({
    status: existing.status,
    lockedAt: existing.lockedAt,
  })
  if (!existing.bible || !existing.beatSheet || !existing.ledger || !existing.emotionalCurve) {
    throw new Error('EDIT_BIBLE_REVISION_REQUIRES_READY_BUNDLE')
  }
  const sourceDocument = await readEpisodeSourceDocumentById({
    projectId: input.projectId,
    episodeId: input.episodeId,
    sourceDocumentId: existing.sourceDocumentId,
  })
  const bundle = validateEditBibleBundle({
    bundle: editBibleBundleSchema.parse({
      bible: input.patch.bible ?? existing.bible,
      beatSheet: input.patch.beatSheet ?? existing.beatSheet,
      ledger: input.patch.ledger ?? existing.ledger,
      emotionalCurve: input.patch.emotionalCurve ?? existing.emotionalCurve,
    }),
    sourceText: sourceDocument.normalizedText,
  })

  return await prisma.$transaction(async (tx) => {
    await assertEpisodeAccess({ ...input, client: tx })
    await assertNoDownstreamChapterArtifacts({
      episodeId: input.episodeId,
      client: tx,
    })
    const current = await tx.projectEditBible.findUnique({
      where: { episodeId: input.episodeId },
      select: persistedBibleSelect,
    })
    if (!current) throw new ApiError('NOT_FOUND')
    assertEditBibleCanBeRevised({
      status: current.status,
      lockedAt: current.lockedAt,
    })
    const version = current.version + 1
    const plans = splitEditBibleIntoChapterPlans({
      bundle,
      sourceText: sourceDocument.normalizedText,
    })
    const chapters = await writeChapterPlans({
      tx,
      episodeId: input.episodeId,
      sourceDocumentId: current.sourceDocumentId,
      bibleVersion: version,
      bundle,
      plans,
    })
    await tx.projectEditStylePreview.deleteMany({
      where: { editBibleId: current.id },
    })
    const updated = await tx.projectEditBible.update({
      where: { id: current.id },
      data: {
        bibleJson: toInputJsonValue(bundle.bible),
        beatSheetJson: toInputJsonValue(bundle.beatSheet),
        ledgerJson: toInputJsonValue(bundle.ledger),
        emotionalCurveJson: toInputJsonValue(bundle.emotionalCurve),
        styleBibleJson: Prisma.JsonNull,
        diagnosticsJson: Prisma.JsonNull,
        version,
        status: EDIT_BIBLE_STATUS.READY_FOR_REVIEW,
      },
      select: persistedBibleSelect,
    })
    return {
      editBible: mapPersistedBible(updated, input.projectId),
      chapters,
    }
  })
}
