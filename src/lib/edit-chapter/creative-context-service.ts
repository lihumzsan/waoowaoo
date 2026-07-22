import {
  CREATIVE_RESOURCE_SCHEMA,
  getProjectCreativeResourceCard,
  type CreativeResourceRevisionContent,
} from '@/lib/creative-resource'
import {
  compileCreativeChapterContext,
  CreativeContextCompilerError,
  type CompiledCreativeChapterContextResult,
  type CreativeContextAsset,
} from '@/lib/creative-worker'
import { normalizeCreativeBibleResourceBundle } from '@/lib/edit-bible'
import { creativeStyleBibleSchema } from '@/lib/creative-style/contracts'
import type { LedgerEntityRef } from '@/lib/edit-ledger'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export interface CreativeChapterAssetReference {
  readonly resourceId: string
  readonly revisionId: string
  readonly fingerprint: string
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
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
}).strict()

const chapterProvenanceSchema = z.object({
  sourceResourceId: z.string().trim().min(1),
  sourceRevisionId: z.string().trim().min(1),
  sourceFingerprint: z.string().trim().min(1),
  chapterPlanResourceId: z.string().trim().min(1),
  chapterPlanRevisionId: z.string().trim().min(1),
  chapterPlanFingerprint: z.string().trim().min(1),
  bible: exactResourceRevisionSchema.nullable(),
  contextRevisions: z.array(exactResourceRevisionSchema.extend({
    schemaId: z.string().trim().min(1),
  }).strict()),
  beatIds: z.array(z.string().trim().min(1)),
  eventIds: z.array(z.string().trim().min(1)),
}).strict()

type ExactResourceRevision = z.infer<typeof exactResourceRevisionSchema>

function exactReferenceKey(reference: ExactResourceRevision): string {
  return `${reference.resourceId}:${reference.revisionId}:${reference.fingerprint}`
}

async function resolveOptionalBibleBundle(input: {
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
      resourceId: input.reference.resourceId,
      fingerprint: input.reference.fingerprint,
      resource: {
        userId: input.userId,
        projectId: input.projectId,
        episodeId: input.episodeId,
        status: 'ready',
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE,
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
    fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { resourceId: input.reference.resourceId })
  }
  return normalizeCreativeBibleResourceBundle({
    rawBundle: revision.contentJson,
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
    const card = await getProjectCreativeResourceCard({
      projectId: input.projectId,
      userId: input.userId,
      resourceId: reference.resourceId,
    })
    if (!card) {
      fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { resourceId: reference.resourceId })
    }
    const resource = card.resource
    const revision = resource.headRevision
    if (!revision) {
      fail('CREATIVE_CONTEXT_RESOURCE_NOT_FOUND', { resourceId: reference.resourceId })
    }
    if (
      revision.revisionId !== reference.revisionId
      || revision.fingerprint !== reference.fingerprint
    ) {
      fail('CREATIVE_CONTEXT_RESOURCE_REVISION_CHANGED', {
        resourceId: reference.resourceId,
        expectedRevisionId: reference.revisionId,
        actualRevisionId: revision.revisionId,
      })
    }
    return {
      asset: {
        resourceId: resource.resourceId,
        revisionId: revision.revisionId,
        fingerprint: revision.fingerprint,
        mediaType: resource.mediaType,
        schemaId: resource.schemaId,
        name: resource.name,
        description: resourceDescription({
          name: resource.name,
          prompt: revision.provenance.prompt,
          content: revision.content,
        }),
        prompt: revision.provenance.prompt,
        mediaId: revision.content.kind === 'media' ? revision.content.mediaId : null,
        entityRef: reference.entityRef,
      },
      content: revision.content,
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
            sourceFingerprint: true,
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
      || provenance.data.sourceFingerprint !== chapter.sourceDocument.sourceFingerprint
    ) {
      fail('CREATIVE_CONTEXT_SOURCE_MISMATCH', { chapterId: chapter.id })
    }
    return { chapter, provenance: provenance.data }
  })
  const bibleRefs = new Map<string, ExactResourceRevision>()
  const bibleRefKeys = new Set<string>()
  for (const parsed of parsedChapters) {
    if (parsed.provenance.bible) {
      const key = exactReferenceKey(parsed.provenance.bible)
      bibleRefKeys.add(key)
      bibleRefs.set(key, parsed.provenance.bible)
    } else {
      bibleRefKeys.add('none')
    }
  }
  if (bibleRefKeys.size > 1) {
    fail('CREATIVE_CONTEXT_INPUT_INVALID', { label: 'chapterBibleRevisions' })
  }
  const firstChapter = parsedChapters[0]
  if (!firstChapter) fail('CREATIVE_CONTEXT_CHAPTER_NOT_FOUND', { episodeId: input.episodeId })
  const commonSourceRevisionIds = new Set(parsedChapters.map((parsed) => parsed.provenance.sourceRevisionId))
  if (commonSourceRevisionIds.size !== 1) {
    fail('CREATIVE_CONTEXT_SOURCE_MISMATCH', { episodeId: input.episodeId })
  }
  const bibleBundle = await resolveOptionalBibleBundle({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    sourceRevisionId: firstChapter.provenance.sourceRevisionId,
    sourceText: firstChapter.chapter.sourceDocument.normalizedText,
    reference: bibleRefs.values().next().value ?? null,
  })
  const styleResources = referencedResources.filter(
    (resource) => resource.asset.schemaId === CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
  )
  if (styleResources.length > 1) {
    fail('CREATIVE_CONTEXT_ASSET_CONFLICT', { label: 'styleBible', styleBibleCount: styleResources.length })
  }
  const styleResource = styleResources[0]
  if (styleResource && styleResource.content.kind !== 'structured') {
    fail('CREATIVE_CONTEXT_INPUT_INVALID', { label: 'styleBibleContent' })
  }
  const parsedStyleBible = styleResource
    ? creativeStyleBibleSchema.safeParse(styleResource.content.kind === 'structured' ? styleResource.content.data : null)
    : null
  if (parsedStyleBible && !parsedStyleBible.success) {
    fail('CREATIVE_CONTEXT_INPUT_INVALID', {
      label: 'styleBible',
      issueCount: parsedStyleBible.error.issues.length,
    })
  }
  const referencedAssets = referencedResources
    .filter((resource) => resource.asset.schemaId !== CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE)
    .map((resource) => resource.asset)
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
      bibleBundle,
      styleBible: parsedStyleBible?.data ?? null,
      styleBibleSource: styleResource ? {
        resourceId: styleResource.asset.resourceId,
        revisionId: styleResource.asset.revisionId,
        fingerprint: styleResource.asset.fingerprint,
      } : null,
      referencedAssets,
      maxChars: input.maxCharsPerChapter,
    })
  })
}
