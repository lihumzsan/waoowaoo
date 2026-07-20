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
import { readEpisodeEditBible } from '@/lib/edit-bible'
import { editScriptStyleBibleSchema } from '@/lib/edit-script/types'
import type { LedgerEntityRef } from '@/lib/edit-ledger'
import { prisma } from '@/lib/prisma'

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
  const [persistedBible, chapters, referencedResources] = await Promise.all([
    readEpisodeEditBible({ projectId: input.projectId, episodeId: input.episodeId }),
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
      },
    }),
    resolveCreativeContextResources({
      projectId: input.projectId,
      userId: input.userId,
      references: input.referencedAssets,
    }),
  ])
  if (
    !persistedBible
    || !persistedBible.bible
    || !persistedBible.beatSheet
    || !persistedBible.ledger
    || !persistedBible.emotionalCurve
  ) {
    fail('CREATIVE_CONTEXT_BIBLE_INCOMPLETE', { episodeId: input.episodeId })
  }
  const styleResources = referencedResources.filter(
    (resource) => resource.asset.schemaId === CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
  )
  if (styleResources.length !== 1) {
    fail('CREATIVE_CONTEXT_STYLE_BIBLE_REQUIRED', {
      episodeId: input.episodeId,
      styleBibleCount: styleResources.length,
    })
  }
  const styleResource = styleResources[0]
  if (!styleResource || styleResource.content.kind !== 'structured') {
    fail('CREATIVE_CONTEXT_STYLE_BIBLE_REQUIRED', { episodeId: input.episodeId })
  }
  const parsedStyleBible = editScriptStyleBibleSchema.shape.styleBible.safeParse(styleResource.content.data)
  if (!parsedStyleBible.success) {
    fail('CREATIVE_CONTEXT_INPUT_INVALID', {
      label: 'styleBible',
      issueCount: parsedStyleBible.error.issues.length,
    })
  }
  const referencedAssets = referencedResources
    .filter((resource) => resource.asset.schemaId !== CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE)
    .map((resource) => resource.asset)
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]))
  return input.chapterIds.map((chapterId) => {
    const chapter = chapterById.get(chapterId)
    if (!chapter) fail('CREATIVE_CONTEXT_CHAPTER_NOT_FOUND', { chapterId })
    return compileCreativeChapterContext({
      sourceDocument: {
        id: persistedBible.sourceDocumentId,
        normalizedText: persistedBible.sourceText,
      },
      chapter,
      bibleBundle: {
        bible: persistedBible.bible,
        beatSheet: persistedBible.beatSheet,
        ledger: persistedBible.ledger,
        emotionalCurve: persistedBible.emotionalCurve,
      },
      styleBible: parsedStyleBible.data,
      styleBibleSource: {
        resourceId: styleResource.asset.resourceId,
        revisionId: styleResource.asset.revisionId,
        fingerprint: styleResource.asset.fingerprint,
      },
      referencedAssets,
      maxChars: input.maxCharsPerChapter,
    })
  })
}
