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
import { screenplaySchema } from '@/lib/screenplay'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { prisma } from '@/lib/prisma'
import { validateStoryCanonBundle } from './cross-check'
import { CREATIVE_CHAPTER_MAX_DURATION_SECONDS } from './constraints'
import {
  creativeChapterPlanOutputSchema,
  storyCanonBeatSheetSchema,
  storyCanonEmotionalCurveSchema,
  storyCanonSchema,
  rawStoryCanonBundleSchema,
  type StoryCanon,
  type StoryCanonBeatSheet,
  type StoryCanonBundle,
  type CreativeChapterPlanItem,
  type StoryCanonEmotionalCurve,
} from './schemas'
import {
  normalizeRawBeatSheet,
  normalizeRawStoryCanon,
  normalizeRawEmotionalCurve,
  normalizeRawLedger,
} from './source-anchor-normalization'

type PrismaClientLike = typeof prisma | Prisma.TransactionClient

export interface PersistedStoryCanonBundle {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly sourceResourceId: string
  readonly sourceRevisionId: string
  readonly storyCanonResourceId: string
  readonly storyCanonRevisionId: string
  readonly sourceText: string
  readonly version: number
  readonly updatedAt: Date
  readonly storyCanon: StoryCanon
  readonly beatSheet: StoryCanonBeatSheet
  readonly ledger: Ledger
  readonly emotionalCurve: StoryCanonEmotionalCurve
}

export interface PersistedEditChapterPlan extends CreativeChapterPlanItem {
  readonly id: string
  readonly beatIds: readonly string[]
  readonly eventIds: readonly string[]
  readonly updatedAt: Date
}

const persistedStoryCanonSelect = {
  id: true,
  episodeId: true,
  sourceDocumentId: true,
  storyCanonJson: true,
  beatSheetJson: true,
  ledgerJson: true,
  emotionalCurveJson: true,
  storyCanonResourceId: true,
  storyCanonRevisionId: true,
  version: true,
  updatedAt: true,
  sourceDocument: {
    select: {
      normalizedText: true,
      sourceResourceId: true,
      sourceRevisionId: true,
    },
  },
} as const

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function mapPersistedStoryCanon(record: {
  readonly id: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly storyCanonJson: Prisma.JsonValue | null
  readonly beatSheetJson: Prisma.JsonValue | null
  readonly ledgerJson: Prisma.JsonValue | null
  readonly emotionalCurveJson: Prisma.JsonValue | null
  readonly storyCanonResourceId: string
  readonly storyCanonRevisionId: string
  readonly version: number
  readonly updatedAt: Date
  readonly sourceDocument: {
    readonly normalizedText: string
    readonly sourceResourceId: string
    readonly sourceRevisionId: string
  }
}, projectId: string): PersistedStoryCanonBundle {
  const sourceResourceId = record.sourceDocument.sourceResourceId
  const sourceRevisionId = record.sourceDocument.sourceRevisionId
  return {
    id: record.id,
    projectId,
    episodeId: record.episodeId,
    sourceDocumentId: record.sourceDocumentId,
    sourceResourceId,
    sourceRevisionId,
    storyCanonResourceId: record.storyCanonResourceId,
    storyCanonRevisionId: record.storyCanonRevisionId,
    sourceText: record.sourceDocument.normalizedText,
    version: record.version,
    updatedAt: record.updatedAt,
    storyCanon: storyCanonSchema.parse(record.storyCanonJson),
    beatSheet: storyCanonBeatSheetSchema.parse(record.beatSheetJson),
    ledger: ledgerSchema.parse(record.ledgerJson),
    emotionalCurve: storyCanonEmotionalCurveSchema.parse(record.emotionalCurveJson),
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

export function normalizeStoryCanonResourceBundle(input: {
  readonly rawBundle: unknown
  readonly sourceText: string
}): StoryCanonBundle {
  const raw = rawStoryCanonBundleSchema.parse(input.rawBundle)
  const blocks = buildEditSourceBlocks(input.sourceText)
  const beatSheet = normalizeRawBeatSheet({
    raw: raw.beatSheet,
    sourceText: input.sourceText,
    blocks,
  })
  return validateStoryCanonBundle({
    sourceText: input.sourceText,
    bundle: {
      storyCanon: normalizeRawStoryCanon({ raw: raw.storyCanon }),
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
  readonly revisionId: string
  readonly schemaId:
    | typeof CREATIVE_RESOURCE_SCHEMA.SCREENPLAY
    | typeof CREATIVE_RESOURCE_SCHEMA.STORY_CANON
    | typeof CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN
  readonly outputKind: 'screenplay' | 'story_canon' | 'chapter_plan'
  readonly resourceScope: 'project' | 'episode'
}) {
  const revision = await input.tx.creativeResourceRevision.findFirst({
    where: {
      id: input.revisionId,
      resource: {
        userId: input.userId,
        projectId: input.projectId,
        episodeId: input.resourceScope === 'project' ? null : input.episodeId,
        status: 'ready',
        mediaType: 'text',
        schemaId: input.schemaId,
        ...(input.outputKind === 'screenplay' ? {} : { sourceType: 'CreativeWorkResult' }),
      },
    },
    select: {
      id: true,
      resourceId: true,
      contentText: true,
      contentJson: true,
      operationId: true,
      taskId: true,
      task: { select: { type: true, status: true, payload: true } },
      outputLineage: { select: { inputRevisionId: true, role: true, position: true } },
    },
  })
  if (!revision) {
    throw new ApiError('NOT_FOUND', { code: 'CREATIVE_TEXT_REVISION_NOT_FOUND', field: 'revisionId' })
  }
  if (
    input.outputKind === 'screenplay'
    && revision.taskId === null
    && revision.operationId === 'create_text'
    && revision.contentJson !== null
  ) {
    const screenplay = screenplaySchema.safeParse(revision.contentJson)
    if (screenplay.success && screenplay.data.source.kind === 'provided') return revision
  }
  if (!revision.taskId || !revision.task) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_TEXT_REVISION_PROVENANCE_INVALID',
      field: 'revisionId',
      agentRetryableAfterCorrection: true,
    })
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

export async function adoptStoryCanonResources(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplay: { readonly revisionId: string }
  readonly storyCanon: { readonly revisionId: string }
  readonly expectedVersion?: number | null
  readonly client?: Prisma.TransactionClient
}): Promise<PersistedStoryCanonBundle> {
  const adopt = async (tx: Prisma.TransactionClient): Promise<PersistedStoryCanonBundle> => {
    await assertEpisodeAccess({ ...input, client: tx })
    const [screenplayRevision, storyCanonRevision] = await Promise.all([
      resolveCreativeTextRevision({
        tx,
        ...input,
        ...input.screenplay,
        schemaId: CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
        outputKind: 'screenplay',
        resourceScope: 'project',
      }),
      resolveCreativeTextRevision({
        tx,
        ...input,
        ...input.storyCanon,
        schemaId: CREATIVE_RESOURCE_SCHEMA.STORY_CANON,
        outputKind: 'story_canon',
        resourceScope: 'project',
      }),
    ])
    if (screenplayRevision.contentJson === null || storyCanonRevision.contentJson === null) {
      throw new Error('STORY_CANON_RESOURCE_CONTENT_INVALID')
    }
    const screenplayText = screenplaySchema.parse(screenplayRevision.contentJson).screenplayText
    const sourceLineage = storyCanonRevision.outputLineage.filter((lineage) => (
      lineage.inputRevisionId === screenplayRevision.id && lineage.role === 'source_material'
    ))
    if (sourceLineage.length !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'STORY_CANON_SCREENPLAY_LINEAGE_REQUIRED',
        field: 'storyCanon.revisionId',
        agentRetryableAfterCorrection: true,
      })
    }
    const sourceDocument = await materializeScreenplayResourceProjection({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      resourceId: screenplayRevision.resourceId,
      revisionId: screenplayRevision.id,
      text: screenplayText,
      client: tx,
    })
    const bundle = normalizeStoryCanonResourceBundle({
      rawBundle: storyCanonRevision.contentJson,
      sourceText: sourceDocument.normalizedText,
    })
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM project_episodes WHERE id = ${input.episodeId} FOR UPDATE
    `)
    const current = await tx.projectStoryCanon.findUnique({
      where: { episodeId: input.episodeId },
      select: persistedStoryCanonSelect,
    })
    if (current?.storyCanonRevisionId === storyCanonRevision.id) {
      if (
        current.sourceDocumentId !== sourceDocument.id
        || current.storyCanonResourceId !== storyCanonRevision.resourceId
      ) {
        throw new Error(`STORY_CANON_ADOPTION_COLLISION:${storyCanonRevision.id}`)
      }
      return mapPersistedStoryCanon(current, input.projectId)
    }
    const expectedVersion = input.expectedVersion ?? null
    if ((current?.version ?? null) !== expectedVersion) {
      throw new ApiError('CONFLICT', {
        code: 'STORY_CANON_ADOPTION_VERSION_CONFLICT',
        expectedVersion,
        actualVersion: current?.version ?? null,
      })
    }
    const data = {
      sourceDocumentId: sourceDocument.id,
      storyCanonJson: toInputJsonValue(bundle.storyCanon),
      beatSheetJson: toInputJsonValue(bundle.beatSheet),
      ledgerJson: toInputJsonValue(bundle.ledger),
      emotionalCurveJson: toInputJsonValue(bundle.emotionalCurve),
      storyCanonResourceId: storyCanonRevision.resourceId,
      storyCanonRevisionId: storyCanonRevision.id,
      version: (current?.version ?? 0) + 1,
    }
    const stored = current
      ? await tx.projectStoryCanon.update({ where: { id: current.id }, data, select: persistedStoryCanonSelect })
      : await tx.projectStoryCanon.create({
          data: { episodeId: input.episodeId, ...data },
          select: persistedStoryCanonSelect,
        })
    return mapPersistedStoryCanon(stored, input.projectId)
  }
  return input.client ? await adopt(input.client) : await prisma.$transaction(adopt)
}

interface ExactCreativeRevisionRef {
  readonly revisionId: string
}

interface ChapterPlanProvenance {
  readonly sourceResourceId: string
  readonly sourceRevisionId: string
  readonly chapterPlanResourceId: string
  readonly chapterPlanRevisionId: string
  readonly storyCanon: ExactCreativeRevisionRef | null
  readonly contextRevisions: readonly (ExactCreativeRevisionRef & { readonly schemaId: string })[]
  readonly beatIds: readonly string[]
  readonly eventIds: readonly string[]
}

function chapterFacts(input: {
  readonly bundle: StoryCanonBundle | null
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
  readonly bundle: StoryCanonBundle | null
  readonly plans: readonly CreativeChapterPlanItem[]
  readonly planVersion: number
}): Promise<readonly PersistedEditChapterPlan[]> {
  await input.tx.projectEditChapter.deleteMany({
    where: { episodeId: input.episodeId },
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
    const record = await input.tx.projectEditChapter.create({
      data: { episodeId: input.episodeId, chapterIndex: plan.chapterIndex, ...data },
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
  readonly id: string
}): ExactCreativeRevisionRef {
  return {
    revisionId: input.id,
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
        schemaId: CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
        outputKind: 'screenplay',
        resourceScope: 'project',
      }),
      resolveCreativeTextRevision({
        tx,
        ...input,
        ...input.chapterPlan,
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN,
        outputKind: 'chapter_plan',
        resourceScope: 'episode',
      }),
    ])
    if (screenplayRevision.contentJson === null || chapterPlanRevision.contentJson === null) {
      throw new Error('CREATIVE_CHAPTER_PLAN_RESOURCE_CONTENT_INVALID')
    }
    const screenplayText = screenplaySchema.parse(screenplayRevision.contentJson).screenplayText
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
    const storyCanonCandidates = scopedLineageRevisions.filter((revision) => (
      revision.resource.schemaId === CREATIVE_RESOURCE_SCHEMA.STORY_CANON
      && revision.resource.mediaType === 'text'
      && revision.resource.sourceType === 'CreativeWorkResult'
    ))
    if (storyCanonCandidates.length > 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_CHAPTER_PLAN_STORY_CANON_LINEAGE_AMBIGUOUS',
        field: 'chapterPlan.revisionId',
        agentRetryableAfterCorrection: true,
      })
    }
    const storyCanonRevision = storyCanonCandidates[0] ?? null
    const contextRevisions = scopedLineageRevisions
      .filter((revision) => revision.id !== screenplayRevision.id)
      .map((revision) => ({
        ...exactRevisionRef(revision),
        schemaId: revision.resource.schemaId,
      }))
      .sort((left, right) => left.revisionId.localeCompare(right.revisionId))
    let storyCanonBundle: StoryCanonBundle | null = null
    let storyCanonRef: ExactCreativeRevisionRef | null = null
    if (storyCanonRevision) {
      const payload = storyCanonRevision.task?.payload
      const request = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { request?: { outputKind?: unknown } }).request
        : null
      const hasScreenplayLineage = storyCanonRevision.outputLineage.some((lineage) => (
        lineage.inputRevisionId === screenplayRevision.id && lineage.role === 'source_material'
      ))
      if (
        !storyCanonRevision.taskId
        || storyCanonRevision.task?.type !== TASK_TYPE.CREATIVE_WORK
        || storyCanonRevision.task.status !== TASK_STATUS.COMPLETED
        || request?.outputKind !== 'story_canon'
        || storyCanonRevision.contentJson === null
        || !hasScreenplayLineage
      ) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_CHAPTER_PLAN_STORY_CANON_LINEAGE_INVALID',
          field: 'chapterPlan.revisionId',
          agentRetryableAfterCorrection: true,
        })
      }
      storyCanonBundle = normalizeStoryCanonResourceBundle({
        rawBundle: storyCanonRevision.contentJson,
        sourceText: screenplayText,
      })
      storyCanonRef = exactRevisionRef(storyCanonRevision)
    }
    const output = creativeChapterPlanOutputSchema.parse(chapterPlanRevision.contentJson)
    assertOrderedNonOverlappingSourceRanges(screenplayText, output.chapters)
    for (const chapter of output.chapters) {
      if (chapter.targetDurationSec > CREATIVE_CHAPTER_MAX_DURATION_SECONDS) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_CHAPTER_DURATION_EXCEEDS_LIMIT',
          field: `chapters.${String(chapter.chapterIndex)}.targetDurationSec`,
          agentRetryableAfterCorrection: true,
        })
      }
      if (!screenplayText.slice(chapter.sourceStart, chapter.sourceEnd).trim()) {
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
      text: screenplayText,
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
        chapterPlanResourceId: chapterPlanRevision.resourceId,
        chapterPlanRevisionId: chapterPlanRevision.id,
        storyCanon: storyCanonRef,
        contextRevisions,
      },
      bundle: storyCanonBundle,
      plans: output.chapters,
      planVersion,
    })
  }
  return input.client ? await adopt(input.client) : await prisma.$transaction(adopt)
}

export async function readEpisodeStoryCanon(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly client?: PrismaClientLike
}): Promise<PersistedStoryCanonBundle | null> {
  const client = input.client ?? prisma
  const record = await client.projectStoryCanon.findFirst({
    where: { episodeId: input.episodeId, episode: { projectId: input.projectId } },
    select: persistedStoryCanonSelect,
  })
  return record ? mapPersistedStoryCanon(record, input.projectId) : null
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
