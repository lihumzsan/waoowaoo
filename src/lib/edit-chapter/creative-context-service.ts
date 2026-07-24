import {
  CREATIVE_RESOURCE_SCHEMA,
  isCreativeResourceMediaType,
  type CreativeResourceJsonValue,
  type CreativeResourceRevisionContent,
} from '@/lib/creative-resource'
import {
  compileCreativeChapterContext,
  CreativeContextCompilerError,
  type CompiledCreativeChapterContextResult,
  type CreativeContextAsset,
} from '@/lib/creative-worker'
import { normalizeStoryCanonResourceBundle } from '@/lib/story-canon'
import type { LedgerEntityRef } from '@/lib/edit-ledger'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export interface CreativeChapterAssetReference {
  readonly revisionId: string
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
  readonly content: CreativeResourceRevisionContent
}): string {
  const prompt = input.prompt?.trim()
  if (prompt) return prompt
  if (input.content.kind === 'text' && input.content.text.trim()) return input.content.text.trim()
  if (input.content.kind === 'structured') {
    const serialized = JSON.stringify(input.content.data)
    if (serialized && serialized !== 'null') return serialized
  }
  if (input.content.kind === 'domain_snapshot') {
    const serialized = JSON.stringify(input.content.snapshot)
    if (serialized && serialized !== 'null') return serialized
  }
  return input.name
}

interface ResolvedCreativeContextResource {
  readonly asset: CreativeContextAsset
  readonly content: CreativeResourceRevisionContent
}

const exactResourceRevisionSchema = z.object({
  revisionId: z.string().trim().min(1),
}).strict()

const chapterProvenanceSchema = z.object({
  sourceResourceId: z.string().trim().min(1),
  sourceRevisionId: z.string().trim().min(1),
  chapterPlanResourceId: z.string().trim().min(1),
  chapterPlanRevisionId: z.string().trim().min(1),
  storyCanon: exactResourceRevisionSchema.nullable(),
  contextRevisions: z.array(exactResourceRevisionSchema.extend({
    schemaId: z.string().trim().min(1),
  }).strict()),
  beatIds: z.array(z.string().trim().min(1)),
  eventIds: z.array(z.string().trim().min(1)),
}).strict()

type ExactResourceRevision = z.infer<typeof exactResourceRevisionSchema>

function exactReferenceKey(reference: ExactResourceRevision): string {
  return reference.revisionId
}

async function resolveOptionalStoryCanonBundle(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceRevisionId: string
  readonly sourceText: string
  readonly reference: ExactResourceRevision | null
}) {
  if (!input.reference) return null
  const revision = await prisma.creativeResourceRevision.findFirst({
    where: {
      id: input.reference.revisionId,
      resource: {
        userId: input.userId,
        projectId: input.projectId,
        episodeId: null,
        status: 'ready',
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.STORY_CANON,
        sourceType: 'CreativeWorkResult',
      },
    },
    select: {
      contentJson: true,
      outputLineage: { select: { inputRevisionId: true, role: true } },
    },
  })
  if (
    !revision
    || revision.contentJson === null
    || !revision.outputLineage.some((lineage) => (
      lineage.inputRevisionId === input.sourceRevisionId && lineage.role === 'source_material'
    ))
  ) {
    fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { revisionId: input.reference.revisionId })
  }
  return normalizeStoryCanonResourceBundle({
    rawBundle: revision.contentJson,
    sourceText: input.sourceText,
  })
}

async function resolveCreativeContextResources(input: {
  readonly projectId: string
  readonly userId: string
  readonly references: readonly CreativeChapterAssetReference[]
}): Promise<ResolvedCreativeContextResource[]> {
  requireUnique(input.references.map((reference) => reference.revisionId), 'revisionId')
  return await Promise.all(input.references.map(async (reference) => {
    const revision = await prisma.creativeResourceRevision.findFirst({
      where: {
        id: reference.revisionId,
        resource: {
          userId: input.userId,
          projectId: input.projectId,
          status: 'ready',
        },
      },
      select: {
        id: true,
        contentText: true,
        contentJson: true,
        sourceType: true,
        sourceId: true,
        sourceRevision: true,
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
        resource: {
          select: { id: true, mediaType: true, schemaId: true, name: true },
        },
      },
    })
    if (!revision) {
      fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { revisionId: reference.revisionId })
    }
    if (revision.resource.schemaId === CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION) {
      fail('CREATIVE_CONTEXT_INPUT_INVALID', {
        label: 'creativeDirectionIsServerInjected',
        revisionId: reference.revisionId,
      })
    }
    if (!isCreativeResourceMediaType(revision.resource.mediaType)) {
      fail('CREATIVE_CONTEXT_INPUT_INVALID', { label: 'resourceMediaType' })
    }
    const content: CreativeResourceRevisionContent = revision.media
      ? {
          kind: 'media',
          mediaId: revision.media.id,
          url: `/m/${encodeURIComponent(revision.media.publicId)}`,
          mimeType: revision.media.mimeType,
          width: revision.media.width,
          height: revision.media.height,
          durationMs: revision.media.durationMs,
        }
      : revision.sourceType && revision.sourceId && revision.sourceRevision && revision.contentJson !== null
        ? {
            kind: 'domain_snapshot',
            sourceType: revision.sourceType,
            sourceId: revision.sourceId,
            sourceRevision: revision.sourceRevision,
            snapshot: revision.contentJson as CreativeResourceJsonValue,
          }
        : revision.contentText !== null
          ? { kind: 'text', text: revision.contentText }
          : revision.contentJson !== null
            ? { kind: 'structured', data: revision.contentJson as CreativeResourceJsonValue }
            : fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { revisionId: reference.revisionId })
    return {
      asset: {
        resourceId: revision.resource.id,
        revisionId: revision.id,
        mediaType: revision.resource.mediaType,
        schemaId: revision.resource.schemaId,
        name: revision.resource.name,
        description: resourceDescription({
          name: revision.resource.name,
          prompt: revision.prompt,
          content,
        }),
        prompt: revision.prompt,
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
            sourceRevisionId: true,
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
      || provenance.data.sourceRevisionId !== chapter.sourceDocument.sourceRevisionId
    ) {
      fail('CREATIVE_CONTEXT_SOURCE_MISMATCH', { chapterId: chapter.id })
    }
    return { chapter, provenance: provenance.data }
  })
  const storyCanonRefs = new Map<string, ExactResourceRevision>()
  const storyCanonRefKeys = new Set<string>()
  for (const parsed of parsedChapters) {
    if (parsed.provenance.storyCanon) {
      const key = exactReferenceKey(parsed.provenance.storyCanon)
      storyCanonRefKeys.add(key)
      storyCanonRefs.set(key, parsed.provenance.storyCanon)
    } else {
      storyCanonRefKeys.add('none')
    }
  }
  if (storyCanonRefKeys.size > 1) {
    fail('CREATIVE_CONTEXT_INPUT_INVALID', { label: 'chapterStoryCanonRevisions' })
  }
  const firstChapter = parsedChapters[0]
  if (!firstChapter) fail('CREATIVE_CONTEXT_CHAPTER_NOT_FOUND', { episodeId: input.episodeId })
  const commonSourceRevisionIds = new Set(parsedChapters.map((parsed) => parsed.provenance.sourceRevisionId))
  if (commonSourceRevisionIds.size !== 1) {
    fail('CREATIVE_CONTEXT_SOURCE_MISMATCH', { episodeId: input.episodeId })
  }
  const storyCanonBundle = await resolveOptionalStoryCanonBundle({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    sourceRevisionId: firstChapter.provenance.sourceRevisionId,
    sourceText: firstChapter.chapter.sourceDocument.normalizedText,
    reference: storyCanonRefs.values().next().value ?? null,
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
