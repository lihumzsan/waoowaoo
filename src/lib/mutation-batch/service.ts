import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { getProjectChannel } from '@/lib/task/publisher'
import { createScopedLogger } from '@/lib/logging/core'
import { WORKSPACE_SSE_EVENT_TYPE, type MutationBatchSSEEvent } from '@/lib/task/types'
import type { Prisma } from '@prisma/client'

export type MutationBatchStatus = 'active' | 'reverted' | 'failed'

export type MutationEntrySpec = {
  kind: string
  targetType: string
  targetId: string
  payload?: unknown
}

export type CreateMutationBatchParams = {
  projectId: string
  userId: string
  source: string
  operationId?: string | null
  summary?: string | null
  entries: MutationEntrySpec[]
  episodeId?: string | null
}

type MutationBatchWithEntries = {
  id: string
  projectId: string
  userId: string
  operationId: string | null
  createdAt: Date
  entries: Array<{ targetType: string; targetId: string }>
}

export function buildMutationBatchSSEEvent(params: {
  batchId: string
  projectId: string
  userId: string
  operationId: string | null
  episodeId: string | null
  entries: Array<{ targetType: string; targetId: string }>
  createdAt: Date
}): MutationBatchSSEEvent {
  return {
    id: `mb:${params.createdAt.getTime()}:${params.batchId}`,
    type: WORKSPACE_SSE_EVENT_TYPE.MUTATION_BATCH,
    mutationBatchId: params.batchId,
    projectId: params.projectId,
    userId: params.userId,
    ts: params.createdAt.toISOString(),
    operationId: params.operationId,
    episodeId: params.episodeId,
    targets: params.entries.map((entry) => ({
      targetType: entry.targetType,
      targetId: entry.targetId,
    })),
  }
}

async function publishMutationBatchEvent(params: Parameters<typeof buildMutationBatchSSEEvent>[0]) {
  try {
    const event = buildMutationBatchSSEEvent(params)
    await redis.publish(getProjectChannel(params.projectId), JSON.stringify(event))
  } catch (error) {
    createScopedLogger({
      module: 'mutation-batch',
      action: 'mutation_batch.sse_publish_failed',
      projectId: params.projectId,
      userId: params.userId,
    }).error({
      message: 'failed to publish mutation batch sse event',
      details: {
        mutationBatchId: params.batchId,
        operationId: params.operationId,
        targetCount: params.entries.length,
      },
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
    })
  }
}

function resolveReplayEpisodeId(entries: Array<{ targetType: string }>, episodeId: string | null) {
  const hasEpisodeScopedTarget = entries.some(
    (entry) => entry.targetType === 'ProjectVideoSegment' || entry.targetType === 'ProjectEpisode',
  )
  return hasEpisodeScopedTarget ? episodeId : null
}

export async function listMutationBatchReplayEvents(params: {
  projectId: string
  userId: string
  after: {
    createdAt: Date
    batchId: string
  }
  episodeId?: string | null
  limit?: number
}): Promise<MutationBatchSSEEvent[]> {
  const limit = Math.max(1, Math.min(500, params.limit ?? 200))
  const batches = (await prisma.mutationBatch.findMany({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      OR: [
        { createdAt: { gt: params.after.createdAt } },
        {
          createdAt: params.after.createdAt,
          id: { gt: params.after.batchId },
        },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    include: {
      entries: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })) as MutationBatchWithEntries[]

  return batches.map((batch) =>
    buildMutationBatchSSEEvent({
      batchId: batch.id,
      projectId: batch.projectId,
      userId: batch.userId,
      operationId: batch.operationId,
      episodeId: resolveReplayEpisodeId(batch.entries, params.episodeId ?? null),
      entries: batch.entries,
      createdAt: batch.createdAt,
    }),
  )
}

export async function createMutationBatchInTransaction(tx: Prisma.TransactionClient, params: CreateMutationBatchParams) {
  if (params.entries.length === 0) {
    throw new Error('MUTATION_BATCH_ENTRIES_REQUIRED')
  }
  return await tx.mutationBatch.create({
    data: {
      projectId: params.projectId,
      userId: params.userId,
      source: params.source,
      operationId: params.operationId ?? null,
      summary: params.summary ?? null,
      entries: {
        create: params.entries.map((entry) => ({
          kind: entry.kind,
          targetType: entry.targetType,
          targetId: entry.targetId,
          ...(entry.payload === undefined ? {} : { payload: entry.payload as Prisma.InputJsonValue }),
        })),
      },
    },
    include: { entries: true },
  })
}

export async function createMutationBatch(params: CreateMutationBatchParams) {
  const batch = await prisma.$transaction(async (tx) => await createMutationBatchInTransaction(tx, params))

  await publishMutationBatchEvent({
    batchId: batch.id,
    projectId: params.projectId,
    userId: params.userId,
    operationId: params.operationId ?? null,
    episodeId: params.episodeId ?? null,
    entries: batch.entries,
    createdAt: batch.createdAt,
  })

  return batch
}

export async function listRecentMutationBatches(params: { projectId: string; userId: string; limit?: number }) {
  const limit = Math.max(1, Math.min(20, params.limit ?? 10))
  return prisma.mutationBatch.findMany({
    where: {
      projectId: params.projectId,
      userId: params.userId,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      entries: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })
}

export async function markMutationBatchReverted(params: { batchId: string; status: MutationBatchStatus; revertError?: string | null }) {
  return prisma.mutationBatch.update({
    where: { id: params.batchId },
    data: {
      status: params.status,
      revertError: params.revertError ?? null,
      revertedAt: params.status === 'reverted' ? new Date() : null,
    },
  })
}
