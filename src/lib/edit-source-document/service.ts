import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { assertEditSourceDocumentWithinTokenBudget } from './estimator'
import { isEditSourceDocumentValidationError } from './errors'
import { normalizeEditSourceDocumentText } from './normalize'

type PrismaClientLike = typeof prisma | Prisma.TransactionClient

export interface EditSourceDocumentRecord {
  readonly id: string
  readonly episodeId: string
  readonly normalizedText: string
  readonly checksum: string
  readonly version: number
  readonly sourceResourceId: string
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
  version: true,
  sourceResourceId: true,
  createdAt: true,
  updatedAt: true,
} as const

function checksumNormalizedText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function mapSourceDocument(record: {
  readonly id: string
  readonly episodeId: string
  readonly normalizedText: string
  readonly checksum: string
  readonly version: number
  readonly sourceResourceId: string
  readonly createdAt: Date
  readonly updatedAt: Date
}): EditSourceDocumentRecord {
  return record
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

/**
 * Builds the immutable source-range projection used by Story Canon and Chapter
 * algorithms from one exact screenplay Resource. The Resource remains the
 * screenplay authority; this row is only its indexed
 * text projection and can never be confirmed or edited independently.
 */
export async function materializeScreenplayResourceProjection(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly resourceId: string
  readonly text: string
  readonly client: Prisma.TransactionClient
}): Promise<CreatedEditSourceDocument> {
  await assertEpisodeAccess({ ...input, client: input.client })
  let normalizedText: string
  let estimatedInputTokens: number
  try {
    normalizedText = normalizeEditSourceDocumentText(input.text)
    estimatedInputTokens = assertEditSourceDocumentWithinTokenBudget(normalizedText)
  } catch (error: unknown) {
    if (!isEditSourceDocumentValidationError(error)) throw error
    throw new ApiError('INVALID_PARAMS', { code: error.code, message: error.message })
  }
  const checksum = checksumNormalizedText(normalizedText)
  await input.client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM project_episodes WHERE id = ${input.episodeId} FOR UPDATE
  `
  const existing = await input.client.projectEpisodeSourceDocument.findUnique({
    where: {
      episodeId_sourceResourceId: {
        episodeId: input.episodeId,
        sourceResourceId: input.resourceId,
      },
    },
    select: editSourceDocumentSelect,
  })
  if (existing) {
    if (
      existing.sourceResourceId !== input.resourceId
      || existing.normalizedText !== normalizedText
    ) {
      throw new Error(`SCREENPLAY_RESOURCE_PROJECTION_COLLISION:${input.resourceId}`)
    }
    return { ...mapSourceDocument(existing), estimatedInputTokens }
  }
  const latest = await input.client.projectEpisodeSourceDocument.findFirst({
    where: { episodeId: input.episodeId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const record = await input.client.projectEpisodeSourceDocument.create({
    data: {
      episodeId: input.episodeId,
      normalizedText,
      checksum,
      version: (latest?.version ?? 0) + 1,
      sourceResourceId: input.resourceId,
    },
    select: editSourceDocumentSelect,
  })
  return { ...mapSourceDocument(record), estimatedInputTokens }
}
