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
  readonly storyCanonResourceId: string
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
  version: true,
  updatedAt: true,
  sourceDocument: {
    select: {
      normalizedText: true,
      sourceResourceId: true,
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
  readonly version: number
  readonly updatedAt: Date
  readonly sourceDocument: {
    readonly normalizedText: string
    readonly sourceResourceId: string
  }
}, projectId: string): PersistedStoryCanonBundle {
  const sourceResourceId = record.sourceDocument.sourceResourceId
  return {
    id: record.id,
    projectId,
    episodeId: record.episodeId,
    sourceDocumentId: record.sourceDocumentId,
    sourceResourceId,
    storyCanonResourceId: record.storyCanonResourceId,
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

async function resolveCreativeTextResource(input: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly resourceId: string
  readonly schemaId:
    | typeof CREATIVE_RESOURCE_SCHEMA.SCREENPLAY
    | typeof CREATIVE_RESOURCE_SCHEMA.STORY_CANON
    | typeof CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN
  readonly outputKind: 'screenplay' | 'story_canon' | 'chapter_plan'
  readonly resourceScope: 'project' | 'episode'
}) {
  const resource = await input.tx.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: input.resourceScope === 'project' ? null : input.episodeId,
      status: 'ready',
      materializedAt: { not: null },
      mediaType: 'text',
      schemaId: input.schemaId,
      ...(input.outputKind === 'screenplay' ? {} : { sourceType: 'CreativeWorkResult' }),
    },
    select: {
      id: true,
      contentText: true,
      contentJson: true,
      operationId: true,
      taskId: true,
      task: { select: { type: true, status: true, payload: true } },
      outputLineage: { select: { inputResourceId: true, role: true, position: true } },
    },
  })
  if (!resource) {
    throw new ApiError('NOT_FOUND', { code: 'CREATIVE_TEXT_RESOURCE_NOT_FOUND', field: 'resourceId' })
  }
  if (
    input.outputKind === 'screenplay'
    && resource.taskId === null
    && resource.operationId === 'create_text'
    && resource.contentJson !== null
  ) {
    const screenplay = screenplaySchema.safeParse(resource.contentJson)
    if (screenplay.success && screenplay.data.source.kind === 'provided') return resource
  }
  if (!resource.taskId || !resource.task) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_TEXT_RESOURCE_PROVENANCE_INVALID',
      field: 'resourceId',
      agentRetryableAfterCorrection: true,
    })
  }
  const payload = resource.task.payload
  const request = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as { request?: { outputKind?: unknown } }).request
    : null
  if (
    resource.task.type !== TASK_TYPE.CREATIVE_WORK
    || resource.task.status !== TASK_STATUS.COMPLETED
    || request?.outputKind !== input.outputKind
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_TEXT_RESOURCE_PROVENANCE_INVALID',
      field: 'resourceId',
      agentRetryableAfterCorrection: true,
    })
  }
  return resource
}

export async function adoptStoryCanonResources(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplay: { readonly resourceId: string }
  readonly storyCanon: { readonly resourceId: string }
  readonly expectedVersion?: number | null
  readonly client?: Prisma.TransactionClient
}): Promise<PersistedStoryCanonBundle> {
  const adopt = async (tx: Prisma.TransactionClient): Promise<PersistedStoryCanonBundle> => {
    await assertEpisodeAccess({ ...input, client: tx })
    const [screenplayResource, storyCanonResource] = await Promise.all([
      resolveCreativeTextResource({
        tx,
        ...input,
        ...input.screenplay,
        schemaId: CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
        outputKind: 'screenplay',
        resourceScope: 'project',
      }),
      resolveCreativeTextResource({
        tx,
        ...input,
        ...input.storyCanon,
        schemaId: CREATIVE_RESOURCE_SCHEMA.STORY_CANON,
        outputKind: 'story_canon',
        resourceScope: 'project',
      }),
    ])
    if (screenplayResource.contentJson === null || storyCanonResource.contentJson === null) {
      throw new Error('STORY_CANON_RESOURCE_CONTENT_INVALID')
    }
    const screenplayText = screenplaySchema.parse(screenplayResource.contentJson).screenplayText
    const sourceLineage = storyCanonResource.outputLineage.filter((lineage) => (
      lineage.inputResourceId === screenplayResource.id && lineage.role === 'source_material'
    ))
    if (sourceLineage.length !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'STORY_CANON_SCREENPLAY_LINEAGE_REQUIRED',
        field: 'storyCanon.resourceId',
        agentRetryableAfterCorrection: true,
      })
    }
    const sourceDocument = await materializeScreenplayResourceProjection({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      resourceId: screenplayResource.id,
      text: screenplayText,
      client: tx,
    })
    const bundle = normalizeStoryCanonResourceBundle({
      rawBundle: storyCanonResource.contentJson,
      sourceText: sourceDocument.normalizedText,
    })
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM project_episodes WHERE id = ${input.episodeId} FOR UPDATE
    `)
    const current = await tx.projectStoryCanon.findUnique({
      where: { episodeId: input.episodeId },
      select: persistedStoryCanonSelect,
    })
    if (current?.storyCanonResourceId === storyCanonResource.id) {
      if (
        current.sourceDocumentId !== sourceDocument.id
      ) {
        throw new Error(`STORY_CANON_ADOPTION_COLLISION:${storyCanonResource.id}`)
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
      storyCanonResourceId: storyCanonResource.id,
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

interface ExactCreativeResourceRef {
  readonly resourceId: string
}

interface ChapterPlanProvenance {
  readonly sourceResourceId: string
  readonly chapterPlanResourceId: string
  readonly storyCanon: ExactCreativeResourceRef | null
  readonly contextResources: readonly (ExactCreativeResourceRef & { readonly schemaId: string })[]
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

function exactResourceRef(input: {
  readonly id: string
}): ExactCreativeResourceRef {
  return {
    resourceId: input.id,
  }
}

export async function adoptCreativeChapterPlan(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplay: ExactCreativeResourceRef
  readonly chapterPlan: ExactCreativeResourceRef
  readonly client?: Prisma.TransactionClient
}): Promise<readonly PersistedEditChapterPlan[]> {
  const adopt = async (tx: Prisma.TransactionClient): Promise<readonly PersistedEditChapterPlan[]> => {
    await assertEpisodeAccess({ ...input, client: tx })
    const [screenplayResource, chapterPlanResource] = await Promise.all([
      resolveCreativeTextResource({
        tx,
        ...input,
        ...input.screenplay,
        schemaId: CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
        outputKind: 'screenplay',
        resourceScope: 'project',
      }),
      resolveCreativeTextResource({
        tx,
        ...input,
        ...input.chapterPlan,
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN,
        outputKind: 'chapter_plan',
        resourceScope: 'episode',
      }),
    ])
    if (screenplayResource.contentJson === null || chapterPlanResource.contentJson === null) {
      throw new Error('CREATIVE_CHAPTER_PLAN_RESOURCE_CONTENT_INVALID')
    }
    const screenplayText = screenplaySchema.parse(screenplayResource.contentJson).screenplayText
    const screenplayLineage = chapterPlanResource.outputLineage.filter((lineage) => (
      lineage.inputResourceId === screenplayResource.id && lineage.role === 'source_material'
    ))
    if (screenplayLineage.length !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_CHAPTER_PLAN_SCREENPLAY_LINEAGE_REQUIRED',
        field: 'chapterPlan.resourceId',
        agentRetryableAfterCorrection: true,
      })
    }
    const lineageResourceIds = chapterPlanResource.outputLineage.map((lineage) => lineage.inputResourceId)
    const uniqueLineageResourceIds = [...new Set(lineageResourceIds)]
    const scopedLineageResources = await tx.creativeResource.findMany({
      where: {
        id: { in: uniqueLineageResourceIds },
        userId: input.userId,
        projectId: input.projectId,
        status: 'ready',
        materializedAt: { not: null },
        OR: [{ episodeId: input.episodeId }, { episodeId: null }],
      },
      select: {
        id: true,
        contentJson: true,
        taskId: true,
        task: { select: { type: true, status: true, payload: true } },
        outputLineage: { select: { inputResourceId: true, role: true } },
        schemaId: true,
        mediaType: true,
        sourceType: true,
      },
    })
    if (scopedLineageResources.length !== uniqueLineageResourceIds.length) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_CHAPTER_PLAN_CONTEXT_LINEAGE_SCOPE_INVALID',
        field: 'chapterPlan.resourceId',
        agentRetryableAfterCorrection: true,
      })
    }
    const storyCanonCandidates = scopedLineageResources.filter((resource) => (
      resource.schemaId === CREATIVE_RESOURCE_SCHEMA.STORY_CANON
      && resource.mediaType === 'text'
      && resource.sourceType === 'CreativeWorkResult'
    ))
    if (storyCanonCandidates.length > 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_CHAPTER_PLAN_STORY_CANON_LINEAGE_AMBIGUOUS',
        field: 'chapterPlan.resourceId',
        agentRetryableAfterCorrection: true,
      })
    }
    const storyCanonResource = storyCanonCandidates[0] ?? null
    const contextResources = scopedLineageResources
      .filter((resource) => resource.id !== screenplayResource.id)
      .map((resource) => ({
        ...exactResourceRef(resource),
        schemaId: resource.schemaId,
      }))
      .sort((left, right) => left.resourceId.localeCompare(right.resourceId))
    let storyCanonBundle: StoryCanonBundle | null = null
    let storyCanonRef: ExactCreativeResourceRef | null = null
    if (storyCanonResource) {
      const payload = storyCanonResource.task?.payload
      const request = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { request?: { outputKind?: unknown } }).request
        : null
      const hasScreenplayLineage = storyCanonResource.outputLineage.some((lineage) => (
        lineage.inputResourceId === screenplayResource.id && lineage.role === 'source_material'
      ))
      if (
        !storyCanonResource.taskId
        || storyCanonResource.task?.type !== TASK_TYPE.CREATIVE_WORK
        || storyCanonResource.task.status !== TASK_STATUS.COMPLETED
        || request?.outputKind !== 'story_canon'
        || storyCanonResource.contentJson === null
        || !hasScreenplayLineage
      ) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_CHAPTER_PLAN_STORY_CANON_LINEAGE_INVALID',
          field: 'chapterPlan.resourceId',
          agentRetryableAfterCorrection: true,
        })
      }
      storyCanonBundle = normalizeStoryCanonResourceBundle({
        rawBundle: storyCanonResource.contentJson,
        sourceText: screenplayText,
      })
      storyCanonRef = exactResourceRef(storyCanonResource)
    }
    const output = creativeChapterPlanOutputSchema.parse(chapterPlanResource.contentJson)
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
      resourceId: screenplayResource.id,
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
        && (provenance as { chapterPlanResourceId?: unknown }).chapterPlanResourceId === chapterPlanResource.id
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
        sourceResourceId: screenplayResource.id,
        chapterPlanResourceId: chapterPlanResource.id,
        storyCanon: storyCanonRef,
        contextResources,
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
