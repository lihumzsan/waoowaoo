import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import {
  assertOrderedNonOverlappingSourceRanges,
  buildEditSourceBlocks,
  materializeScreenplayResourceProjection,
} from '@/lib/edit-source-document'
import {
  collectLedgerEventsInRange,
  ledgerSchema,
  projectLedgerSnapshotAtSourceOffset,
  type Ledger,
} from '@/lib/edit-ledger'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { prisma } from '@/lib/prisma'
import { validateEditBibleBundle } from './cross-check'
import { CREATIVE_CHAPTER_MAX_DURATION_SECONDS } from './constraints'
import {
  creativeChapterPlanOutputSchema,
  editBibleBeatSheetSchema,
  editBibleEmotionalCurveSchema,
  editBibleSchema,
  rawEditBibleBundleSchema,
  type EditBible,
  type EditBibleBeatSheet,
  type EditBibleBundle,
  type CreativeChapterPlanItem,
  type EditBibleEmotionalCurve,
} from './schemas'
import {
  normalizeRawBeatSheet,
  normalizeRawEditBible,
  normalizeRawEmotionalCurve,
  normalizeRawLedger,
} from './source-anchor-normalization'

type PrismaClientLike = typeof prisma | Prisma.TransactionClient

export interface PersistedEditBibleBundle {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly sourceResourceId: string
  readonly sourceRevisionId: string
  readonly sourceFingerprint: string
  readonly bibleResourceId: string
  readonly bibleRevisionId: string
  readonly bibleFingerprint: string
  readonly sourceText: string
  readonly version: number
  readonly updatedAt: Date
  readonly bible: EditBible
  readonly beatSheet: EditBibleBeatSheet
  readonly ledger: Ledger
  readonly emotionalCurve: EditBibleEmotionalCurve
}

export interface PersistedEditChapterPlan extends CreativeChapterPlanItem {
  readonly id: string
  readonly beatIds: readonly string[]
  readonly eventIds: readonly string[]
  readonly updatedAt: Date
}

const persistedBibleSelect = {
  id: true,
  episodeId: true,
  sourceDocumentId: true,
  bibleJson: true,
  beatSheetJson: true,
  ledgerJson: true,
  emotionalCurveJson: true,
  bibleResourceId: true,
  bibleRevisionId: true,
  bibleFingerprint: true,
  version: true,
  updatedAt: true,
  sourceDocument: {
    select: {
      normalizedText: true,
      sourceResourceId: true,
      sourceRevisionId: true,
      sourceFingerprint: true,
    },
  },
} as const

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function mapPersistedBible(record: {
  readonly id: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly bibleJson: Prisma.JsonValue | null
  readonly beatSheetJson: Prisma.JsonValue | null
  readonly ledgerJson: Prisma.JsonValue | null
  readonly emotionalCurveJson: Prisma.JsonValue | null
  readonly bibleResourceId: string
  readonly bibleRevisionId: string
  readonly bibleFingerprint: string
  readonly version: number
  readonly updatedAt: Date
  readonly sourceDocument: {
    readonly normalizedText: string
    readonly sourceResourceId: string
    readonly sourceRevisionId: string
    readonly sourceFingerprint: string
  }
}, projectId: string): PersistedEditBibleBundle {
  const sourceResourceId = record.sourceDocument.sourceResourceId
  const sourceRevisionId = record.sourceDocument.sourceRevisionId
  const sourceFingerprint = record.sourceDocument.sourceFingerprint
  return {
    id: record.id,
    projectId,
    episodeId: record.episodeId,
    sourceDocumentId: record.sourceDocumentId,
    sourceResourceId,
    sourceRevisionId,
    sourceFingerprint,
    bibleResourceId: record.bibleResourceId,
    bibleRevisionId: record.bibleRevisionId,
    bibleFingerprint: record.bibleFingerprint,
    sourceText: record.sourceDocument.normalizedText,
    version: record.version,
    updatedAt: record.updatedAt,
    bible: editBibleSchema.parse(record.bibleJson),
    beatSheet: editBibleBeatSheetSchema.parse(record.beatSheetJson),
    ledger: ledgerSchema.parse(record.ledgerJson),
    emotionalCurve: editBibleEmotionalCurveSchema.parse(record.emotionalCurveJson),
  }
}

async function assertEpisodeAccess(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly client: PrismaClientLike
}): Promise<void> {
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

export function normalizeCreativeBibleResourceBundle(input: {
  readonly rawBundle: unknown
  readonly sourceText: string
}): EditBibleBundle {
  const raw = rawEditBibleBundleSchema.parse(input.rawBundle)
  const blocks = buildEditSourceBlocks(input.sourceText)
  const beatSheet = normalizeRawBeatSheet({
    raw: raw.beatSheet,
    sourceText: input.sourceText,
    blocks,
  })
  return validateEditBibleBundle({
    sourceText: input.sourceText,
    bundle: {
      bible: normalizeRawEditBible({ raw: raw.bible }),
      beatSheet,
      ledger: normalizeRawLedger({ raw: raw.ledger, beatSheet }),
      emotionalCurve: normalizeRawEmotionalCurve({
        raw: raw.emotionalCurve,
        sourceText: input.sourceText,
        blocks,
      }),
    },
  })
}

async function resolveCreativeTextRevision(input: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly resourceId: string
  readonly revisionId: string
  readonly fingerprint: string
  readonly schemaId:
    | typeof CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT
    | typeof CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE
    | typeof CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN
  readonly outputKind: 'screenplay_draft' | 'edit_bible_bundle' | 'chapter_plan'
}) {
  const revision = await input.tx.creativeResourceRevision.findFirst({
    where: {
      id: input.revisionId,
      resourceId: input.resourceId,
      fingerprint: input.fingerprint,
      resource: {
        userId: input.userId,
        projectId: input.projectId,
        episodeId: input.episodeId,
        status: 'ready',
        mediaType: 'text',
        schemaId: input.schemaId,
        sourceType: 'CreativeWorkResult',
      },
    },
    select: {
      id: true,
      resourceId: true,
      fingerprint: true,
      contentText: true,
      contentJson: true,
      taskId: true,
      task: { select: { type: true, status: true, payload: true } },
      outputLineage: { select: { inputRevisionId: true, role: true, position: true } },
    },
  })
  if (!revision?.taskId || !revision.task) {
    throw new ApiError('NOT_FOUND', { code: 'CREATIVE_TEXT_REVISION_NOT_FOUND', field: 'revisionId' })
  }
  const payload = revision.task.payload
  const request = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as { request?: { outputKind?: unknown } }).request
    : null
  if (
    revision.task.type !== TASK_TYPE.CREATIVE_WORK
    || revision.task.status !== TASK_STATUS.COMPLETED
    || request?.outputKind !== input.outputKind
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_TEXT_REVISION_PROVENANCE_INVALID',
      field: 'revisionId',
      agentRetryableAfterCorrection: true,
    })
  }
  return revision
}

export async function adoptCreativeBibleResources(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplay: { readonly resourceId: string; readonly revisionId: string; readonly fingerprint: string }
  readonly bible: { readonly resourceId: string; readonly revisionId: string; readonly fingerprint: string }
  readonly expectedVersion?: number | null
  readonly client?: Prisma.TransactionClient
}): Promise<PersistedEditBibleBundle> {
  const adopt = async (tx: Prisma.TransactionClient): Promise<PersistedEditBibleBundle> => {
    await assertEpisodeAccess({ ...input, client: tx })
    const [screenplayRevision, bibleRevision] = await Promise.all([
      resolveCreativeTextRevision({
        tx,
        ...input,
        ...input.screenplay,
        schemaId: CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT,
        outputKind: 'screenplay_draft',
      }),
      resolveCreativeTextRevision({
        tx,
        ...input,
        ...input.bible,
        schemaId: CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE,
        outputKind: 'edit_bible_bundle',
      }),
    ])
    if (!screenplayRevision.contentText || bibleRevision.contentJson === null) {
      throw new Error('CREATIVE_BIBLE_RESOURCE_CONTENT_INVALID')
    }
    const sourceLineage = bibleRevision.outputLineage.filter((lineage) => (
      lineage.inputRevisionId === screenplayRevision.id && lineage.role === 'source_material'
    ))
    if (sourceLineage.length !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_BIBLE_SCREENPLAY_LINEAGE_REQUIRED',
        field: 'bible.revisionId',
        agentRetryableAfterCorrection: true,
      })
    }
    const sourceDocument = await materializeScreenplayResourceProjection({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      resourceId: screenplayRevision.resourceId,
      revisionId: screenplayRevision.id,
      fingerprint: screenplayRevision.fingerprint,
      text: screenplayRevision.contentText,
      client: tx,
    })
    const bundle = normalizeCreativeBibleResourceBundle({
      rawBundle: bibleRevision.contentJson,
      sourceText: sourceDocument.normalizedText,
    })
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM project_episodes WHERE id = ${input.episodeId} FOR UPDATE
    `)
    const current = await tx.projectEditBible.findUnique({
      where: { episodeId: input.episodeId },
      select: persistedBibleSelect,
    })
    if (current?.bibleRevisionId === bibleRevision.id) {
      if (
        current.sourceDocumentId !== sourceDocument.id
        || current.bibleResourceId !== bibleRevision.resourceId
        || current.bibleFingerprint !== bibleRevision.fingerprint
      ) {
        throw new Error(`CREATIVE_BIBLE_ADOPTION_COLLISION:${bibleRevision.id}`)
      }
      return mapPersistedBible(current, input.projectId)
    }
    const expectedVersion = input.expectedVersion ?? null
    if ((current?.version ?? null) !== expectedVersion) {
      throw new ApiError('CONFLICT', {
        code: 'CREATIVE_BIBLE_ADOPTION_VERSION_CONFLICT',
        expectedVersion,
        actualVersion: current?.version ?? null,
      })
    }
    const data = {
      sourceDocumentId: sourceDocument.id,
      bibleJson: toInputJsonValue(bundle.bible),
      beatSheetJson: toInputJsonValue(bundle.beatSheet),
      ledgerJson: toInputJsonValue(bundle.ledger),
      emotionalCurveJson: toInputJsonValue(bundle.emotionalCurve),
      bibleResourceId: bibleRevision.resourceId,
      bibleRevisionId: bibleRevision.id,
      bibleFingerprint: bibleRevision.fingerprint,
      version: (current?.version ?? 0) + 1,
    }
    const stored = current
      ? await tx.projectEditBible.update({ where: { id: current.id }, data, select: persistedBibleSelect })
      : await tx.projectEditBible.create({
          data: { episodeId: input.episodeId, ...data },
          select: persistedBibleSelect,
        })
    return mapPersistedBible(stored, input.projectId)
  }
  return input.client ? await adopt(input.client) : await prisma.$transaction(adopt)
}

interface ExactCreativeRevisionRef {
  readonly resourceId: string
  readonly revisionId: string
  readonly fingerprint: string
}

interface ChapterPlanProvenance {
  readonly sourceResourceId: string
  readonly sourceRevisionId: string
  readonly sourceFingerprint: string
  readonly chapterPlanResourceId: string
  readonly chapterPlanRevisionId: string
  readonly chapterPlanFingerprint: string
  readonly bible: ExactCreativeRevisionRef | null
  readonly contextRevisions: readonly (ExactCreativeRevisionRef & { readonly schemaId: string })[]
  readonly beatIds: readonly string[]
  readonly eventIds: readonly string[]
}

function chapterFacts(input: {
  readonly bundle: EditBibleBundle | null
  readonly plan: CreativeChapterPlanItem
}): {
  readonly beatIds: readonly string[]
  readonly eventIds: readonly string[]
  readonly events: readonly Ledger['events'][number][]
  readonly entrySnapshot: ReturnType<typeof projectLedgerSnapshotAtSourceOffset>
} {
  if (!input.bundle) {
    return {
      beatIds: [],
      eventIds: [],
      events: [],
      entrySnapshot: { sourceEnd: input.plan.sourceStart, facts: [], entities: [] },
    }
  }
  const overlappingBeats = input.bundle.beatSheet.beats.filter((beat) => (
    beat.sourceStart < input.plan.sourceEnd && beat.sourceEnd > input.plan.sourceStart
  ))
  const events = collectLedgerEventsInRange({
    ledger: input.bundle.ledger,
    sourceStart: input.plan.sourceStart,
    sourceEnd: input.plan.sourceEnd,
  })
  return {
    beatIds: overlappingBeats.map((beat) => beat.beatId),
    eventIds: events.map((event) => event.eventId),
    events,
    entrySnapshot: projectLedgerSnapshotAtSourceOffset({
      ledger: input.bundle.ledger,
      sourceEnd: input.plan.sourceStart,
    }),
  }
}

async function writeAdoptedChapterPlan(input: {
  readonly tx: Prisma.TransactionClient
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly provenance: Omit<ChapterPlanProvenance, 'beatIds' | 'eventIds'>
  readonly bundle: EditBibleBundle | null
  readonly plans: readonly CreativeChapterPlanItem[]
  readonly planVersion: number
}): Promise<readonly PersistedEditChapterPlan[]> {
  const indexes = input.plans.map((plan) => plan.chapterIndex)
  await input.tx.projectEditChapter.deleteMany({
    where: { episodeId: input.episodeId, chapterIndex: { notIn: indexes } },
  })
  const chapters: PersistedEditChapterPlan[] = []
  for (const plan of input.plans) {
    const facts = chapterFacts({ bundle: input.bundle, plan })
    const provenance: ChapterPlanProvenance = {
      ...input.provenance,
      beatIds: facts.beatIds,
      eventIds: facts.eventIds,
    }
    const data = {
      title: plan.title,
      summary: plan.summary,
      sourceDocumentId: input.sourceDocumentId,
      sourceStart: plan.sourceStart,
      sourceEnd: plan.sourceEnd,
      targetDurationSec: plan.targetDurationSec,
      entrySnapshotJson: toInputJsonValue(facts.entrySnapshot),
      eventsJson: toInputJsonValue(facts.events),
      planVersion: input.planVersion,
      provenanceJson: toInputJsonValue(provenance),
    }
    const record = await input.tx.projectEditChapter.upsert({
      where: { episodeId_chapterIndex: { episodeId: input.episodeId, chapterIndex: plan.chapterIndex } },
      create: { episodeId: input.episodeId, chapterIndex: plan.chapterIndex, ...data },
      update: data,
      select: { id: true, updatedAt: true },
    })
    chapters.push({
      ...plan,
      beatIds: facts.beatIds,
      eventIds: facts.eventIds,
      ...record,
    })
  }
  return chapters
}

function exactRevisionRef(input: {
  readonly resourceId: string
  readonly id: string
  readonly fingerprint: string
}): ExactCreativeRevisionRef {
  return {
    resourceId: input.resourceId,
    revisionId: input.id,
    fingerprint: input.fingerprint,
  }
}

export async function adoptCreativeChapterPlan(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplay: ExactCreativeRevisionRef
  readonly chapterPlan: ExactCreativeRevisionRef
  readonly client?: Prisma.TransactionClient
}): Promise<readonly PersistedEditChapterPlan[]> {
  const adopt = async (tx: Prisma.TransactionClient): Promise<readonly PersistedEditChapterPlan[]> => {
    await assertEpisodeAccess({ ...input, client: tx })
    const [screenplayRevision, chapterPlanRevision] = await Promise.all([
      resolveCreativeTextRevision({
        tx,
        ...input,
        ...input.screenplay,
        schemaId: CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT,
        outputKind: 'screenplay_draft',
      }),
      resolveCreativeTextRevision({
        tx,
        ...input,
        ...input.chapterPlan,
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN,
        outputKind: 'chapter_plan',
      }),
    ])
    if (!screenplayRevision.contentText || chapterPlanRevision.contentJson === null) {
      throw new Error('CREATIVE_CHAPTER_PLAN_RESOURCE_CONTENT_INVALID')
    }
    const screenplayLineage = chapterPlanRevision.outputLineage.filter((lineage) => (
      lineage.inputRevisionId === screenplayRevision.id && lineage.role === 'source_material'
    ))
    if (screenplayLineage.length !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_CHAPTER_PLAN_SCREENPLAY_LINEAGE_REQUIRED',
        field: 'chapterPlan.revisionId',
        agentRetryableAfterCorrection: true,
      })
    }
    const lineageRevisionIds = chapterPlanRevision.outputLineage.map((lineage) => lineage.inputRevisionId)
    const uniqueLineageRevisionIds = [...new Set(lineageRevisionIds)]
    const scopedLineageRevisions = await tx.creativeResourceRevision.findMany({
      where: {
        id: { in: uniqueLineageRevisionIds },
        resource: {
          userId: input.userId,
          projectId: input.projectId,
          status: 'ready',
          OR: [{ episodeId: input.episodeId }, { episodeId: null }],
        },
      },
      select: {
        id: true,
        resourceId: true,
        fingerprint: true,
        contentJson: true,
        taskId: true,
        task: { select: { type: true, status: true, payload: true } },
        outputLineage: { select: { inputRevisionId: true, role: true } },
        resource: { select: { schemaId: true, mediaType: true, sourceType: true } },
      },
    })
    if (scopedLineageRevisions.length !== uniqueLineageRevisionIds.length) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_CHAPTER_PLAN_CONTEXT_LINEAGE_SCOPE_INVALID',
        field: 'chapterPlan.revisionId',
        agentRetryableAfterCorrection: true,
      })
    }
    const bibleCandidates = scopedLineageRevisions.filter((revision) => (
      revision.resource.schemaId === CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE
      && revision.resource.mediaType === 'text'
      && revision.resource.sourceType === 'CreativeWorkResult'
    ))
    if (bibleCandidates.length > 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_CHAPTER_PLAN_BIBLE_LINEAGE_AMBIGUOUS',
        field: 'chapterPlan.revisionId',
        agentRetryableAfterCorrection: true,
      })
    }
    const bibleRevision = bibleCandidates[0] ?? null
    const contextRevisions = scopedLineageRevisions
      .filter((revision) => revision.id !== screenplayRevision.id)
      .map((revision) => ({
        ...exactRevisionRef(revision),
        schemaId: revision.resource.schemaId,
      }))
      .sort((left, right) => left.revisionId.localeCompare(right.revisionId))
    let bibleBundle: EditBibleBundle | null = null
    let bibleRef: ExactCreativeRevisionRef | null = null
    if (bibleRevision) {
      const payload = bibleRevision.task?.payload
      const request = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { request?: { outputKind?: unknown } }).request
        : null
      const hasScreenplayLineage = bibleRevision.outputLineage.some((lineage) => (
        lineage.inputRevisionId === screenplayRevision.id && lineage.role === 'source_material'
      ))
      if (
        !bibleRevision.taskId
        || bibleRevision.task?.type !== TASK_TYPE.CREATIVE_WORK
        || bibleRevision.task.status !== TASK_STATUS.COMPLETED
        || request?.outputKind !== 'edit_bible_bundle'
        || bibleRevision.contentJson === null
        || !hasScreenplayLineage
      ) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_CHAPTER_PLAN_BIBLE_LINEAGE_INVALID',
          field: 'chapterPlan.revisionId',
          agentRetryableAfterCorrection: true,
        })
      }
      bibleBundle = normalizeCreativeBibleResourceBundle({
        rawBundle: bibleRevision.contentJson,
        sourceText: screenplayRevision.contentText,
      })
      bibleRef = exactRevisionRef(bibleRevision)
    }
    const output = creativeChapterPlanOutputSchema.parse(chapterPlanRevision.contentJson)
    assertOrderedNonOverlappingSourceRanges(screenplayRevision.contentText, output.chapters)
    for (const chapter of output.chapters) {
      if (chapter.targetDurationSec > CREATIVE_CHAPTER_MAX_DURATION_SECONDS) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_CHAPTER_DURATION_EXCEEDS_LIMIT',
          field: `chapters.${String(chapter.chapterIndex)}.targetDurationSec`,
          agentRetryableAfterCorrection: true,
        })
      }
      if (!screenplayRevision.contentText.slice(chapter.sourceStart, chapter.sourceEnd).trim()) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_CHAPTER_RANGE_EMPTY',
          field: `chapters.${String(chapter.chapterIndex)}`,
          agentRetryableAfterCorrection: true,
        })
      }
    }
    const sourceDocument = await materializeScreenplayResourceProjection({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      resourceId: screenplayRevision.resourceId,
      revisionId: screenplayRevision.id,
      fingerprint: screenplayRevision.fingerprint,
      text: screenplayRevision.contentText,
      client: tx,
    })
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM project_episodes WHERE id = ${input.episodeId} FOR UPDATE
    `)
    const existing = await tx.projectEditChapter.findMany({
      where: { episodeId: input.episodeId },
      select: { planVersion: true, provenanceJson: true },
    })
    const alreadyAdopted = existing.length === output.chapters.length && existing.every((chapter) => {
      const provenance = chapter.provenanceJson
      return provenance && typeof provenance === 'object' && !Array.isArray(provenance)
        && (provenance as { chapterPlanRevisionId?: unknown }).chapterPlanRevisionId === chapterPlanRevision.id
    })
    if (alreadyAdopted) {
      return await readEpisodeEditChapters({
        projectId: input.projectId,
        episodeId: input.episodeId,
        client: tx,
      })
    }
    const planVersion = Math.max(0, ...existing.map((chapter) => chapter.planVersion)) + 1
    return await writeAdoptedChapterPlan({
      tx,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
      provenance: {
        sourceResourceId: screenplayRevision.resourceId,
        sourceRevisionId: screenplayRevision.id,
        sourceFingerprint: screenplayRevision.fingerprint,
        chapterPlanResourceId: chapterPlanRevision.resourceId,
        chapterPlanRevisionId: chapterPlanRevision.id,
        chapterPlanFingerprint: chapterPlanRevision.fingerprint,
        bible: bibleRef,
        contextRevisions,
      },
      bundle: bibleBundle,
      plans: output.chapters,
      planVersion,
    })
  }
  return input.client ? await adopt(input.client) : await prisma.$transaction(adopt)
}

export async function readEpisodeEditBible(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly client?: PrismaClientLike
}): Promise<PersistedEditBibleBundle | null> {
  const client = input.client ?? prisma
  const record = await client.projectEditBible.findFirst({
    where: { episodeId: input.episodeId, episode: { projectId: input.projectId } },
    select: persistedBibleSelect,
  })
  return record ? mapPersistedBible(record, input.projectId) : null
}

export async function readEpisodeEditChapters(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly client?: PrismaClientLike
}): Promise<readonly PersistedEditChapterPlan[]> {
  const client = input.client ?? prisma
  const chapters = await client.projectEditChapter.findMany({
    where: {
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
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
      updatedAt: true,
    },
  })
  return chapters.map((chapter) => {
    const provenance = chapter.provenanceJson && typeof chapter.provenanceJson === 'object'
      ? chapter.provenanceJson as { beatIds?: unknown; eventIds?: unknown }
      : {}
    return {
      id: chapter.id,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      summary: chapter.summary,
      sourceStart: chapter.sourceStart,
      sourceEnd: chapter.sourceEnd,
      targetDurationSec: chapter.targetDurationSec,
      beatIds: Array.isArray(provenance.beatIds)
        ? provenance.beatIds.filter((value): value is string => typeof value === 'string')
        : [],
      eventIds: Array.isArray(provenance.eventIds)
        ? provenance.eventIds.filter((value): value is string => typeof value === 'string')
        : [],
      updatedAt: chapter.updatedAt,
    }
  })
}
