import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { createOutboxCommandInTransaction } from '@/lib/outbox/repository'
import {
  OUTBOX_COMMAND_KIND,
  parseOutboxCommandPayload,
  type WorkspaceResourceBroadcastCommand,
} from '@/lib/outbox/types'
import { getProjectChannel } from '@/lib/task/publisher'
import {
  WORKSPACE_SSE_EVENT_TYPE,
  type ResourceChangedSSEEvent,
  type WorkspaceResourceRef,
} from '@/lib/task/types'
import { dedupeWorkspaceResourceRefs } from './resource-impact'

const WORKSPACE_RESOURCE_AGGREGATE_TYPE = 'workspace_resource'

function workspaceResourceAggregateId(projectId: string, userId: string): string {
  return createHash('sha256')
    .update(projectId)
    .update('\0')
    .update(userId)
    .digest('hex')
}

export function buildWorkspaceResourceBroadcastIdempotencyKey(params: {
  invocationId: string
  projectId: string
}): string {
  const identity = createHash('sha256')
    .update(params.invocationId)
    .update('\0')
    .update(params.projectId)
    .digest('hex')
  return `workspace-resource:${identity}`
}

export function extractWorkspaceResourceChangeEventSpecs(params: {
  affectedResources: readonly WorkspaceResourceRef[]
}): Array<{
  projectId: string
  affectedResources: WorkspaceResourceRef[]
}> {
  const refsByProjectId = new Map<string, WorkspaceResourceRef[]>()
  for (const ref of dedupeWorkspaceResourceRefs(params.affectedResources)) {
    refsByProjectId.set(ref.projectId, [...(refsByProjectId.get(ref.projectId) ?? []), ref])
  }
  return Array.from(refsByProjectId.entries()).map(([projectId, projectRefs]) => ({
    projectId,
    affectedResources: dedupeWorkspaceResourceRefs(projectRefs),
  }))
}

export async function createWorkspaceResourceBroadcastsInTransaction(params: {
  tx: Prisma.TransactionClient
  invocationId: string
  affectedResources: readonly WorkspaceResourceRef[]
  userId: string
  operationId: string
}): Promise<void> {
  const specs = extractWorkspaceResourceChangeEventSpecs(params)
  for (const spec of specs) {
    await createOutboxCommandInTransaction(params.tx, {
      idempotencyKey: buildWorkspaceResourceBroadcastIdempotencyKey({
        invocationId: params.invocationId,
        projectId: spec.projectId,
      }),
      aggregateType: WORKSPACE_RESOURCE_AGGREGATE_TYPE,
      aggregateId: workspaceResourceAggregateId(spec.projectId, params.userId),
      payload: {
        kind: OUTBOX_COMMAND_KIND.WORKSPACE_RESOURCE_BROADCAST,
        projectId: spec.projectId,
        userId: params.userId,
        operationId: params.operationId,
        affectedResources: spec.affectedResources,
      },
    })
  }
}

export function buildWorkspaceResourceChangedEvent(params: {
  outboxId: string
  createdAt: Date
  payload: WorkspaceResourceBroadcastCommand
}): ResourceChangedSSEEvent {
  return {
    id: `wr:${params.createdAt.getTime()}:${params.outboxId}`,
    type: WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
    projectId: params.payload.projectId,
    userId: params.payload.userId,
    ts: params.createdAt.toISOString(),
    affectedResources: params.payload.affectedResources,
  }
}

function requireWorkspaceResourceBroadcastRow(row: {
  id: string
  kind: string
  aggregateType: string
  aggregateId: string
  payload: unknown
  createdAt: Date
}, projectId?: string, userId?: string): ResourceChangedSSEEvent {
  const payload = parseOutboxCommandPayload(row.payload)
  if (
    payload.kind !== OUTBOX_COMMAND_KIND.WORKSPACE_RESOURCE_BROADCAST
    || row.kind !== payload.kind
    || row.aggregateType !== WORKSPACE_RESOURCE_AGGREGATE_TYPE
    || row.aggregateId !== workspaceResourceAggregateId(payload.projectId, payload.userId)
    || (projectId !== undefined && payload.projectId !== projectId)
    || (userId !== undefined && payload.userId !== userId)
  ) {
    throw new Error(`WORKSPACE_RESOURCE_OUTBOX_CONTRACT_MISMATCH:${row.id}`)
  }
  return buildWorkspaceResourceChangedEvent({
    outboxId: row.id,
    createdAt: row.createdAt,
    payload,
  })
}

export async function publishPersistedWorkspaceResourceEventByOutboxId(outboxId: string): Promise<void> {
  const row = await prisma.outboxCommand.findUnique({ where: { id: outboxId } })
  if (!row) throw new Error(`WORKSPACE_RESOURCE_OUTBOX_MISSING:${outboxId}`)
  const event = requireWorkspaceResourceBroadcastRow(row)
  await redis.publish(getProjectChannel(event.projectId), JSON.stringify(event))
}

export async function listWorkspaceResourceReplayEvents(params: {
  projectId: string
  userId: string
  after: {
    createdAt: Date
    outboxId: string
  }
  limit?: number
}): Promise<ResourceChangedSSEEvent[]> {
  const limit = Math.max(1, Math.min(5000, params.limit ?? 500))
  const rows = await prisma.outboxCommand.findMany({
    where: {
      aggregateType: WORKSPACE_RESOURCE_AGGREGATE_TYPE,
      aggregateId: workspaceResourceAggregateId(params.projectId, params.userId),
      kind: OUTBOX_COMMAND_KIND.WORKSPACE_RESOURCE_BROADCAST,
      OR: [
        { createdAt: { gt: params.after.createdAt } },
        {
          createdAt: params.after.createdAt,
          id: { gt: params.after.outboxId },
        },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  return rows.map((row) => requireWorkspaceResourceBroadcastRow(row, params.projectId, params.userId))
}
