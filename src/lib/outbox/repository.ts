import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { CreateOutboxCommandInput } from './types'

export type OutboxTransactionClient = Prisma.TransactionClient

function toInputJson(value: CreateOutboxCommandInput['payload']): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalizeJson(record[key])]),
  )
}

function assertSameOutboxCommand(
  existing: {
    kind: string
    version: number
    aggregateType: string
    aggregateId: string
    payload: unknown
  },
  input: CreateOutboxCommandInput,
): void {
  const same = existing.kind === input.payload.kind
    && existing.version === input.payload.version
    && existing.aggregateType === input.aggregateType
    && existing.aggregateId === input.aggregateId
    && JSON.stringify(canonicalizeJson(existing.payload)) === JSON.stringify(canonicalizeJson(input.payload))
  if (!same) {
    throw new Error(`OUTBOX_IDEMPOTENCY_CONFLICT:${input.idempotencyKey}`)
  }
}

export async function createOutboxCommandInTransaction(
  tx: OutboxTransactionClient,
  input: CreateOutboxCommandInput,
) {
  const command = await tx.outboxCommand.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      kind: input.payload.kind,
      version: input.payload.version,
      idempotencyKey: input.idempotencyKey,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: toInputJson(input.payload),
      availableAt: input.availableAt,
    },
    update: {},
  })
  assertSameOutboxCommand(command, input)
  return command
}

export async function listOutboxCommandsAwaitingEnqueue(limit = 100) {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500)
  return await prisma.outboxCommand.findMany({
    where: {
      acceptedAt: null,
      deadAt: null,
      enqueuedAt: null,
      availableAt: { lte: new Date() },
    },
    orderBy: { createdAt: 'asc' },
    take: safeLimit,
  })
}

export async function markOutboxCommandEnqueued(id: string): Promise<void> {
  await prisma.outboxCommand.updateMany({
    where: { id, acceptedAt: null, deadAt: null },
    data: { enqueuedAt: new Date() },
  })
}

export async function resetOutboxCommandEnqueue(id: string): Promise<void> {
  await prisma.outboxCommand.updateMany({
    where: { id, acceptedAt: null, deadAt: null },
    data: { enqueuedAt: null },
  })
}

export async function claimOutboxCommand(params: {
  id: string
  leaseOwner: string
  leaseMs: number
}) {
  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + Math.max(1_000, params.leaseMs))
  return await prisma.$transaction(async (tx) => {
    const claimed = await tx.outboxCommand.updateMany({
      where: {
        id: params.id,
        acceptedAt: null,
        deadAt: null,
        OR: [
          { leaseOwner: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        leaseOwner: params.leaseOwner,
        leaseExpiresAt,
        deliveryCount: { increment: 1 },
      },
    })
    if (claimed.count === 0) return null
    return await tx.outboxCommand.findUnique({ where: { id: params.id } })
  })
}

export async function acceptOutboxCommand(params: { id: string; leaseOwner: string }): Promise<boolean> {
  const result = await prisma.outboxCommand.updateMany({
    where: {
      id: params.id,
      leaseOwner: params.leaseOwner,
      acceptedAt: null,
      deadAt: null,
    },
    data: {
      acceptedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  })
  return result.count === 1
}

export async function extendOutboxCommandLease(params: {
  id: string
  leaseOwner: string
  leaseMs: number
}): Promise<boolean> {
  const result = await prisma.outboxCommand.updateMany({
    where: {
      id: params.id,
      leaseOwner: params.leaseOwner,
      acceptedAt: null,
      deadAt: null,
    },
    data: {
      leaseExpiresAt: new Date(Date.now() + Math.max(1_000, params.leaseMs)),
    },
  })
  return result.count === 1
}

export async function releaseOutboxCommand(params: {
  id: string
  leaseOwner: string
  error: string
  retryAt: Date
  dead: boolean
}): Promise<void> {
  await prisma.outboxCommand.updateMany({
    where: {
      id: params.id,
      leaseOwner: params.leaseOwner,
      acceptedAt: null,
      deadAt: null,
    },
    data: {
      availableAt: params.retryAt,
      enqueuedAt: null,
      lastError: params.error.slice(0, 8_000),
      deadAt: params.dead ? new Date() : null,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  })
}
