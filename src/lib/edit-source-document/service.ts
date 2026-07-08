import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { assertEditSourceDocumentWithinTokenBudget } from './estimator'
import { isEditSourceDocumentValidationError } from './errors'
import { normalizeEditSourceDocumentText } from './normalize'
import { editSourceDocumentKindSchema, type EditSourceDocumentKind } from './schemas'

type PrismaClientLike = typeof prisma | Prisma.TransactionClient

export interface EditSourceDocumentRecord {
  readonly id: string
  readonly episodeId: string
  readonly normalizedText: string
  readonly checksum: string
  readonly sourceKind: EditSourceDocumentKind
  readonly rawFileMediaId: string | null
  readonly version: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface CreatedEditSourceDocument extends EditSourceDocumentRecord {
  readonly estimatedInputTokens: number
}

const editSourceDocumentSelect = {
  id: true,
  episodeId: true,
  normalizedText: true,
  checksum: true,
  sourceKind: true,
  rawFileMediaId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const

function checksumNormalizedText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function parseSourceKind(value: string): EditSourceDocumentKind {
  return editSourceDocumentKindSchema.parse(value)
}

function mapSourceDocument(record: {
  readonly id: string
  readonly episodeId: string
  readonly normalizedText: string
  readonly checksum: string
  readonly sourceKind: string
  readonly rawFileMediaId: string | null
  readonly version: number
  readonly createdAt: Date
  readonly updatedAt: Date
}): EditSourceDocumentRecord {
  return {
    ...record,
    sourceKind: parseSourceKind(record.sourceKind),
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

export async function assertEpisodeSourceWritable(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly client?: PrismaClientLike
}) {
  const client = input.client ?? prisma
  await assertEpisodeAccess({ ...input, client })
  const bible = await client.projectEditBible.findUnique({
    where: { episodeId: input.episodeId },
    select: { status: true, lockedAt: true },
  })
  if (!bible) return
  if (bible.lockedAt || bible.status === 'confirmed') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SOURCE_DOCUMENT_LOCKED',
      message: 'Episode source document cannot be changed after the edit bible is confirmed.',
    })
  }
  if (bible.status === 'generating') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_GENERATION_ALREADY_RUNNING',
      message: 'Edit bible generation is already running for this episode.',
    })
  }
}

export async function createEpisodeSourceDocument(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly sourceKind: EditSourceDocumentKind
  readonly text: string
  readonly rawFileMediaId?: string
  readonly client?: PrismaClientLike
}): Promise<CreatedEditSourceDocument> {
  const client = input.client ?? prisma
  await assertEpisodeSourceWritable({ ...input, client })

  if (input.sourceKind === 'upload' && !input.rawFileMediaId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SOURCE_DOCUMENT_UPLOAD_MEDIA_REQUIRED',
      message: 'Uploaded source documents must keep the raw file media id.',
    })
  }

  let normalizedText: string
  let estimatedInputTokens: number
  try {
    normalizedText = normalizeEditSourceDocumentText(input.text)
    estimatedInputTokens = assertEditSourceDocumentWithinTokenBudget(normalizedText)
  } catch (error) {
    if (!isEditSourceDocumentValidationError(error)) throw error
    throw new ApiError('INVALID_PARAMS', {
      code: error.code,
      message: error.message,
    })
  }
  const latest = await client.projectEpisodeSourceDocument.findFirst({
    where: { episodeId: input.episodeId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const version = (latest?.version ?? 0) + 1
  const record = await client.projectEpisodeSourceDocument.create({
    data: {
      episodeId: input.episodeId,
      normalizedText,
      checksum: checksumNormalizedText(normalizedText),
      sourceKind: input.sourceKind,
      rawFileMediaId: input.rawFileMediaId ?? null,
      version,
    },
    select: editSourceDocumentSelect,
  })
  return {
    ...mapSourceDocument(record),
    estimatedInputTokens,
  }
}

export async function readLatestEpisodeSourceDocument(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly client?: PrismaClientLike
}): Promise<EditSourceDocumentRecord | null> {
  const client = input.client ?? prisma
  const record = await client.projectEpisodeSourceDocument.findFirst({
    where: {
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
    },
    orderBy: { version: 'desc' },
    select: editSourceDocumentSelect,
  })
  return record ? mapSourceDocument(record) : null
}

export async function readEpisodeSourceDocumentById(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly client?: PrismaClientLike
}): Promise<EditSourceDocumentRecord> {
  const client = input.client ?? prisma
  const record = await client.projectEpisodeSourceDocument.findFirst({
    where: {
      id: input.sourceDocumentId,
      episodeId: input.episodeId,
      episode: { projectId: input.projectId },
    },
    select: editSourceDocumentSelect,
  })
  if (!record) throw new ApiError('NOT_FOUND')
  return mapSourceDocument(record)
}

export async function materializePromptGeneratedSourceDocument(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly sourceDocumentId: string
  readonly text: string
  readonly client?: PrismaClientLike
}): Promise<CreatedEditSourceDocument> {
  const client = input.client ?? prisma
  let normalizedText: string
  let estimatedInputTokens: number
  try {
    normalizedText = normalizeEditSourceDocumentText(input.text)
    estimatedInputTokens = assertEditSourceDocumentWithinTokenBudget(normalizedText)
  } catch (error) {
    if (!isEditSourceDocumentValidationError(error)) throw error
    throw new ApiError('INVALID_PARAMS', {
      code: error.code,
      message: error.message,
    })
  }
  const existing = await client.projectEpisodeSourceDocument.findFirst({
    where: {
      id: input.sourceDocumentId,
      episodeId: input.episodeId,
      sourceKind: 'prompt_generated_outline',
      episode: { projectId: input.projectId },
    },
    select: { id: true },
  })
  if (!existing) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SOURCE_DOCUMENT_PROMPT_GENERATED_REQUIRED',
      message: 'Only prompt-generated source documents can be materialized by the edit bible worker.',
    })
  }
  const record = await client.projectEpisodeSourceDocument.update({
    where: { id: input.sourceDocumentId },
    data: {
      normalizedText,
      checksum: checksumNormalizedText(normalizedText),
      sourceKind: 'prompt_generated_script',
      version: { increment: 1 },
    },
    select: editSourceDocumentSelect,
  })
  return {
    ...mapSourceDocument(record),
    estimatedInputTokens,
  }
}

export async function deleteEpisodeSourceDocumentForRollback(input: {
  readonly sourceDocumentId: string
  readonly client?: PrismaClientLike
}) {
  const client = input.client ?? prisma
  await client.projectEpisodeSourceDocument.deleteMany({
    where: { id: input.sourceDocumentId },
  })
}
