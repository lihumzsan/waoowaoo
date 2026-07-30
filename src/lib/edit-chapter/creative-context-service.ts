import {
  CREATIVE_RESOURCE_SCHEMA,
  isCreativeResourceMediaType,
  type CreativeResourceJsonValue,
  type CreativeResourceContent,
} from '@/lib/creative-resource'
import {
  compileCreativeChapterContext,
  CreativeContextCompilerError,
  type CompiledCreativeChapterContextResult,
  type CreativeContextAsset,
} from '@/lib/creative-worker'
import {
  chapterContinuityPlanOutputSchema,
  normalizeStoryCanonResourceBundle,
} from '@/lib/story-canon'
import type { LedgerEntityRef } from '@/lib/edit-ledger'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export interface CreativeChapterAssetReference {
  readonly resourceId: string
  readonly entityRef: LedgerEntityRef | null
}

export interface CompileEpisodeChapterContextsInput {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly chapterIds: readonly string[]
  readonly referencedAssets: readonly CreativeChapterAssetReference[]
  readonly maxCharsPerChapter: number
}

function fail(
  code: ConstructorParameters<typeof CreativeContextCompilerError>[0],
  details: ConstructorParameters<typeof CreativeContextCompilerError>[1] = {},
): never {
  throw new CreativeContextCompilerError(code, details)
}

function requireUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) fail('CREATIVE_CONTEXT_INPUT_INVALID', { label, duplicate: value })
    seen.add(value)
  }
}

function resourceDescription(input: {
  readonly name: string
  readonly prompt: string | null
  readonly content: CreativeResourceContent
}): string {
  const prompt = input.prompt?.trim()
  if (prompt) return prompt
  if (input.content.kind === 'text' && input.content.text.trim()) return input.content.text.trim()
  if (input.content.kind === 'structured') {
    const serialized = JSON.stringify(input.content.data)
    if (serialized && serialized !== 'null') return serialized
  }
  return input.name
}

interface ResolvedCreativeContextResource {
  readonly asset: CreativeContextAsset
  readonly content: CreativeResourceContent
}

const chapterProvenanceSchema = z.object({
  sourceResourceId: z.string().trim().min(1),
  chapterContinuityPlanResourceId: z.string().trim().min(1),
  beatIds: z.array(z.string().trim().min(1)),
  eventIds: z.array(z.string().trim().min(1)),
}).strict()

interface ExactResourceRef {
  readonly resourceId: string
}

async function resolveChapterContinuityPlanBundle(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceResourceId: string
  readonly sourceText: string
  readonly reference: ExactResourceRef
}) {
  const resource = await prisma.creativeResource.findFirst({
    where: {
      id: input.reference.resourceId,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      status: 'ready',
      materializedAt: { not: null },
      mediaType: 'text',
      schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_CONTINUITY_PLAN,
      sourceType: 'CreativeWorkResult',
    },
    select: {
      contentJson: true,
      outputLineage: { select: { inputResourceId: true, role: true } },
    },
  })
  if (
    !resource
    || resource.contentJson === null
    || !resource.outputLineage.some((lineage) => (
      lineage.inputResourceId === input.sourceResourceId && lineage.role === 'source_material'
    ))
  ) {
    fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { resourceId: input.reference.resourceId })
  }
  const plan = chapterContinuityPlanOutputSchema.parse(resource.contentJson)
  return normalizeStoryCanonResourceBundle({
    rawBundle: plan.storyCanon,
    sourceText: input.sourceText,
  })
}

async function resolveCreativeContextResources(input: {
  readonly projectId: string
  readonly userId: string
  readonly references: readonly CreativeChapterAssetReference[]
}): Promise<ResolvedCreativeContextResource[]> {
  requireUnique(input.references.map((reference) => reference.resourceId), 'resourceId')
  return await Promise.all(input.references.map(async (reference) => {
    const resource = await prisma.creativeResource.findFirst({
      where: {
        id: reference.resourceId,
        userId: input.userId,
        projectId: input.projectId,
        status: 'ready',
        materializedAt: { not: null },
      },
      select: {
        id: true,
        contentText: true,
        contentJson: true,
        sourceType: true,
        sourceId: true,
        prompt: true,
        media: {
          select: {
            id: true,
            publicId: true,
            mimeType: true,
            width: true,
            height: true,
            durationMs: true,
          },
        },
        mediaType: true,
        schemaId: true,
        name: true,
      },
    })
    if (!resource) {
      fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { resourceId: reference.resourceId })
    }
    if (resource.schemaId === CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION) {
      fail('CREATIVE_CONTEXT_INPUT_INVALID', {
        label: 'creativeDirectionIsServerInjected',
        resourceId: reference.resourceId,
      })
    }
    if (!isCreativeResourceMediaType(resource.mediaType)) {
      fail('CREATIVE_CONTEXT_INPUT_INVALID', { label: 'resourceMediaType' })
    }
    const content: CreativeResourceContent = resource.media
      ? {
          kind: 'media',
          mediaId: resource.media.id,
          url: `/m/${encodeURIComponent(resource.media.publicId)}`,
          mimeType: resource.media.mimeType,
          width: resource.media.width,
          height: resource.media.height,
          durationMs: resource.media.durationMs,
        }
      : resource.contentText !== null
        ? { kind: 'text', text: resource.contentText }
        : resource.contentJson !== null
          ? { kind: 'structured', data: resource.contentJson as CreativeResourceJsonValue }
          : fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { resourceId: reference.resourceId })
    return {
      asset: {
        resourceId: resource.id,
        mediaType: resource.mediaType,
        schemaId: resource.schemaId,
        name: resource.name,
        description: resourceDescription({
          name: resource.name,
          prompt: resource.prompt,
          content,
        }),
        prompt: resource.prompt,
        mediaId: content.kind === 'media' ? content.mediaId : null,
        entityRef: reference.entityRef,
      },
      content,
    }
  }))
}

export async function compileEpisodeChapterContexts(
  input: CompileEpisodeChapterContextsInput,
): Promise<CompiledCreativeChapterContextResult[]> {
  requireUnique(input.chapterIds, 'chapterId')
  if (input.chapterIds.length === 0) {
    fail('CREATIVE_CONTEXT_INPUT_INVALID', { label: 'chapterIds' })
  }
  const [chapters, referencedResources] = await Promise.all([
    prisma.projectEditChapter.findMany({
      where: {
        id: { in: [...input.chapterIds] },
        episodeId: input.episodeId,
        episode: {
          projectId: input.projectId,
          project: { userId: input.userId },
        },
      },
      select: {
        id: true,
        episodeId: true,
        chapterIndex: true,
        title: true,
        summary: true,
        sourceDocumentId: true,
        sourceStart: true,
        sourceEnd: true,
        targetDurationSec: true,
        entrySnapshotJson: true,
        eventsJson: true,
        provenanceJson: true,
        sourceDocument: {
          select: {
            id: true,
            normalizedText: true,
            sourceResourceId: true,
          },
        },
      },
    }),
    resolveCreativeContextResources({
      projectId: input.projectId,
      userId: input.userId,
      references: input.referencedAssets,
    }),
  ])
  const parsedChapters = chapters.map((chapter) => {
    const provenance = chapterProvenanceSchema.safeParse(chapter.provenanceJson)
    if (!provenance.success) {
      fail('CREATIVE_CONTEXT_INPUT_INVALID', {
        label: 'chapterProvenance',
        chapterId: chapter.id,
        issueCount: provenance.error.issues.length,
      })
    }
    if (
      chapter.sourceDocument.id !== chapter.sourceDocumentId
      || provenance.data.sourceResourceId !== chapter.sourceDocument.sourceResourceId
    ) {
      fail('CREATIVE_CONTEXT_SOURCE_MISMATCH', { chapterId: chapter.id })
    }
    return { chapter, provenance: provenance.data }
  })
  const planResourceIds = new Set(
    parsedChapters.map((parsed) => parsed.provenance.chapterContinuityPlanResourceId),
  )
  if (planResourceIds.size !== 1) {
    fail('CREATIVE_CONTEXT_INPUT_INVALID', { label: 'chapterContinuityPlanResources' })
  }
  const firstChapter = parsedChapters[0]
  if (!firstChapter) fail('CREATIVE_CONTEXT_CHAPTER_NOT_FOUND', { episodeId: input.episodeId })
  const commonSourceResourceIds = new Set(parsedChapters.map((parsed) => parsed.provenance.sourceResourceId))
  if (commonSourceResourceIds.size !== 1) {
    fail('CREATIVE_CONTEXT_SOURCE_MISMATCH', { episodeId: input.episodeId })
  }
  const chapterContinuityPlanResourceId = planResourceIds.values().next().value
  if (!chapterContinuityPlanResourceId) {
    fail('CREATIVE_CONTEXT_INPUT_INVALID', { label: 'chapterContinuityPlanResourceId' })
  }
  const storyCanonBundle = await resolveChapterContinuityPlanBundle({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    sourceResourceId: firstChapter.provenance.sourceResourceId,
    sourceText: firstChapter.chapter.sourceDocument.normalizedText,
    reference: { resourceId: chapterContinuityPlanResourceId },
  })
  const referencedAssets = referencedResources.map((resource) => resource.asset)
  const chapterById = new Map(parsedChapters.map((parsed) => [parsed.chapter.id, parsed.chapter]))
  return input.chapterIds.map((chapterId) => {
    const chapter = chapterById.get(chapterId)
    if (!chapter) fail('CREATIVE_CONTEXT_CHAPTER_NOT_FOUND', { chapterId })
    return compileCreativeChapterContext({
      sourceDocument: {
        id: chapter.sourceDocument.id,
        normalizedText: chapter.sourceDocument.normalizedText,
      },
      chapter: {
        id: chapter.id,
        episodeId: chapter.episodeId,
        chapterIndex: chapter.chapterIndex,
        title: chapter.title,
        summary: chapter.summary,
        sourceDocumentId: chapter.sourceDocumentId,
        sourceStart: chapter.sourceStart,
        sourceEnd: chapter.sourceEnd,
        targetDurationSec: chapter.targetDurationSec,
        entrySnapshotJson: chapter.entrySnapshotJson,
        eventsJson: chapter.eventsJson,
      },
      storyCanonBundle,
      referencedAssets,
      maxChars: input.maxCharsPerChapter,
    })
  })
}
