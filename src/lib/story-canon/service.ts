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
  chapterContinuityPlanOutputSchema,
  storyCanonBeatSheetSchema,
  storyCanonEmotionalCurveSchema,
  storyCanonSchema,
  rawStoryCanonBundleSchema,
  type StoryCanon,
  type StoryCanonBeatSheet,
  type StoryCanonBundle,
  type ChapterContinuityPlanItem,
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

export interface PersistedEditChapterPlan extends ChapterContinuityPlanItem {
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
    | typeof CREATIVE_RESOURCE_SCHEMA.CHAPTER_CONTINUITY_PLAN
  readonly outputKind: 'screenplay' | 'chapter_continuity_plan'
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

interface ExactCreativeResourceRef {
  readonly resourceId: string
}

interface ChapterContinuityPlanProvenance {
  readonly sourceResourceId: string
  readonly chapterContinuityPlanResourceId: string
  readonly beatIds: readonly string[]
  readonly eventIds: readonly string[]
}

function chapterFacts(input: {
  readonly bundle: StoryCanonBundle
  readonly plan: ChapterContinuityPlanItem
}): {
  readonly beatIds: readonly string[]
  readonly eventIds: readonly string[]
  readonly events: readonly Ledger['events'][number][]
  readonly entrySnapshot: ReturnType<typeof projectLedgerSnapshotAtSourceOffset>
} {
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

async function writeAdoptedChapters(input: {
  readonly tx: Prisma.TransactionClient
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly sourceResourceId: string
  readonly chapterContinuityPlanResourceId: string
  readonly bundle: StoryCanonBundle
  readonly plans: readonly ChapterContinuityPlanItem[]
  readonly planVersion: number
}): Promise<readonly PersistedEditChapterPlan[]> {
  await input.tx.projectEditChapter.deleteMany({
    where: { episodeId: input.episodeId },
  })
  const chapters: PersistedEditChapterPlan[] = []
  for (const plan of input.plans) {
    const facts = chapterFacts({ bundle: input.bundle, plan })
    const provenance: ChapterContinuityPlanProvenance = {
      sourceResourceId: input.sourceResourceId,
      chapterContinuityPlanResourceId: input.chapterContinuityPlanResourceId,
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

export async function adoptChapterContinuityPlan(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplay: ExactCreativeResourceRef
  readonly chapterContinuityPlan: ExactCreativeResourceRef
  readonly expectedVersion?: number | null
  readonly client?: Prisma.TransactionClient
}): Promise<{
  readonly storyCanon: PersistedStoryCanonBundle
  readonly chapters: readonly PersistedEditChapterPlan[]
}> {
  const adopt = async (tx: Prisma.TransactionClient) => {
    await assertEpisodeAccess({ ...input, client: tx })
    const [screenplayResource, planResource] = await Promise.all([
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
        ...input.chapterContinuityPlan,
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_CONTINUITY_PLAN,
        outputKind: 'chapter_continuity_plan',
        resourceScope: 'episode',
      }),
    ])
    if (screenplayResource.contentJson === null || planResource.contentJson === null) {
      throw new Error('CHAPTER_CONTINUITY_PLAN_RESOURCE_CONTENT_INVALID')
    }
    const screenplayText = screenplaySchema.parse(screenplayResource.contentJson).screenplayText
    const screenplayLineage = planResource.outputLineage.filter((lineage) => (
      lineage.inputResourceId === screenplayResource.id && lineage.role === 'source_material'
    ))
    if (screenplayLineage.length !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CHAPTER_CONTINUITY_PLAN_SCREENPLAY_LINEAGE_REQUIRED',
        field: 'chapterContinuityPlan.resourceId',
        agentRetryableAfterCorrection: true,
      })
    }
    const output = chapterContinuityPlanOutputSchema.parse(planResource.contentJson)
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
    const bundle = normalizeStoryCanonResourceBundle({
      rawBundle: output.storyCanon,
      sourceText: sourceDocument.normalizedText,
    })
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM project_episodes WHERE id = ${input.episodeId} FOR UPDATE
    `)
    const [current, existingChapters] = await Promise.all([
      tx.projectStoryCanon.findUnique({
        where: { episodeId: input.episodeId },
        select: persistedStoryCanonSelect,
      }),
      tx.projectEditChapter.findMany({
        where: { episodeId: input.episodeId },
        select: { provenanceJson: true },
      }),
    ])
    const chaptersUsePlan = existingChapters.length === output.chapters.length
      && existingChapters.every((chapter) => {
        const provenance = chapter.provenanceJson
        return provenance !== null && typeof provenance === 'object' && !Array.isArray(provenance)
          && (provenance as { chapterContinuityPlanResourceId?: unknown })
            .chapterContinuityPlanResourceId === planResource.id
      })
    if (current?.storyCanonResourceId === planResource.id && chaptersUsePlan) {
      if (current.sourceDocumentId !== sourceDocument.id) {
        throw new Error(`CHAPTER_CONTINUITY_PLAN_ADOPTION_COLLISION:${planResource.id}`)
      }
      return {
        storyCanon: mapPersistedStoryCanon(current, input.projectId),
        chapters: await readEpisodeEditChapters({
          projectId: input.projectId,
          episodeId: input.episodeId,
          client: tx,
        }),
      }
    }
    const expectedVersion = input.expectedVersion ?? null
    if ((current?.version ?? null) !== expectedVersion) {
      throw new ApiError('CONFLICT', {
        code: 'CHAPTER_CONTINUITY_PLAN_ADOPTION_VERSION_CONFLICT',
        expectedVersion,
        actualVersion: current?.version ?? null,
      })
    }
    const version = (current?.version ?? 0) + 1
    const canonData = {
      sourceDocumentId: sourceDocument.id,
      storyCanonJson: toInputJsonValue(bundle.storyCanon),
      beatSheetJson: toInputJsonValue(bundle.beatSheet),
      ledgerJson: toInputJsonValue(bundle.ledger),
      emotionalCurveJson: toInputJsonValue(bundle.emotionalCurve),
      storyCanonResourceId: planResource.id,
      version,
    }
    const storedCanon = current
      ? await tx.projectStoryCanon.update({
          where: { id: current.id },
          data: canonData,
          select: persistedStoryCanonSelect,
        })
      : await tx.projectStoryCanon.create({
          data: { episodeId: input.episodeId, ...canonData },
          select: persistedStoryCanonSelect,
        })
    const chapters = await writeAdoptedChapters({
      tx,
      episodeId: input.episodeId,
      sourceDocumentId: sourceDocument.id,
      sourceResourceId: screenplayResource.id,
      chapterContinuityPlanResourceId: planResource.id,
      bundle,
      plans: output.chapters,
      planVersion: version,
    })
    return {
      storyCanon: mapPersistedStoryCanon(storedCanon, input.projectId),
      chapters,
    }
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
