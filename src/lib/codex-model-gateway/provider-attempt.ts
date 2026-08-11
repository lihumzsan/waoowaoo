import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma, type ProjectAgentTurn } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  parseFailureRecord,
  type FailureRecord,
} from '@/lib/errors/failure'

const ACTIVE_TURN_STATUSES = ['running', 'waiting_approval'] as const

export type CodexProviderAttemptIdentity = {
  readonly id: string
  readonly sequence: bigint
  readonly turnId: string
  readonly runtimeAttempt: number
  readonly providerKey: string
  readonly modelKey: string
}

type ProviderAttemptTerminal =
  | {
      readonly status: 'succeeded'
      readonly providerStatus: number
      readonly providerRequestId?: string | null
      readonly providerGenerationId?: string | null
    }
  | {
      readonly status: 'failed'
      readonly providerStatus?: number | null
      readonly providerRequestId?: string | null
      readonly providerGenerationId?: string | null
      readonly failure: FailureRecord
    }
  | {
      readonly status: 'cancelled'
      readonly providerStatus?: number | null
      readonly providerRequestId?: string | null
      readonly providerGenerationId?: string | null
    }

function toJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('CODEX_PROVIDER_ATTEMPT_JSON_INVALID')
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function boundedIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized ? normalized.slice(0, 256) : null
}

export async function claimCodexProviderAttempt(input: {
  readonly projectId: string
  readonly userId: string
  readonly turnId: string
  readonly runtimeAttempt: number
  readonly providerKey: string
  readonly modelKey: string
  readonly requestHash: string
}): Promise<CodexProviderAttemptIdentity> {
  if (!Number.isSafeInteger(input.runtimeAttempt) || input.runtimeAttempt < 1) {
    throw new Error('CODEX_PROVIDER_ATTEMPT_RUNTIME_ATTEMPT_INVALID')
  }
  if (
    !input.providerKey
    || input.providerKey !== input.providerKey.trim().toLowerCase()
    || input.providerKey.length > 64
  ) {
    throw new Error('CODEX_PROVIDER_ATTEMPT_PROVIDER_KEY_INVALID')
  }
  if (!input.modelKey || input.modelKey !== input.modelKey.trim() || input.modelKey.length > 191) {
    throw new Error('CODEX_PROVIDER_ATTEMPT_MODEL_KEY_INVALID')
  }
  if (!/^[a-f0-9]{64}$/u.test(input.requestHash)) {
    throw new Error('CODEX_PROVIDER_ATTEMPT_REQUEST_HASH_INVALID')
  }
  return await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (
      !turn
      || turn.projectId !== input.projectId
      || turn.userId !== input.userId
      || turn.attempt !== input.runtimeAttempt
      || turn.cancelRequestId !== null
      || !ACTIVE_TURN_STATUSES.includes(turn.status as (typeof ACTIVE_TURN_STATUSES)[number])
    ) {
      throw new Error('CODEX_PROVIDER_ATTEMPT_TURN_SCOPE_DIVERGED')
    }
    const attempt = await tx.projectAgentProviderAttempt.create({
      data: {
        id: randomUUID(),
        turnId: input.turnId,
        runtimeAttempt: input.runtimeAttempt,
        providerKey: input.providerKey,
        modelKey: input.modelKey,
        requestHash: input.requestHash,
      },
      select: {
        id: true,
        sequence: true,
        turnId: true,
        runtimeAttempt: true,
        providerKey: true,
        modelKey: true,
      },
    })
    return attempt
  })
}

function sameStoredTerminal(
  stored: {
    readonly status: string
    readonly providerStatus: number | null
    readonly providerRequestId: string | null
    readonly providerGenerationId: string | null
    readonly failure: unknown
  },
  terminal: ProviderAttemptTerminal,
): boolean {
  const expectedFailure = terminal.status === 'failed' ? terminal.failure : null
  const storedFailure = stored.failure === null ? null : parseFailureRecord(stored.failure)
  return stored.status === terminal.status
    && stored.providerStatus === (terminal.providerStatus ?? null)
    && stored.providerRequestId === boundedIdentity(terminal.providerRequestId)
    && stored.providerGenerationId === boundedIdentity(terminal.providerGenerationId)
    && isDeepStrictEqual(storedFailure, expectedFailure)
}

async function settleCodexProviderAttempt(
  identity: CodexProviderAttemptIdentity,
  terminal: ProviderAttemptTerminal,
): Promise<void> {
  if (terminal.status === 'failed' && !parseFailureRecord(terminal.failure)) {
    throw new Error('CODEX_PROVIDER_ATTEMPT_FAILURE_INVALID')
  }
  const updated = await prisma.projectAgentProviderAttempt.updateMany({
    where: {
      id: identity.id,
      sequence: identity.sequence,
      turnId: identity.turnId,
      runtimeAttempt: identity.runtimeAttempt,
      providerKey: identity.providerKey,
      modelKey: identity.modelKey,
      status: 'started',
    },
    data: {
      status: terminal.status,
      providerStatus: terminal.providerStatus ?? null,
      providerRequestId: boundedIdentity(terminal.providerRequestId),
      providerGenerationId: boundedIdentity(terminal.providerGenerationId),
      failure: terminal.status === 'failed' ? toJson(terminal.failure) : Prisma.DbNull,
      finishedAt: new Date(),
    },
  })
  if (updated.count === 1) return
  const stored = await prisma.projectAgentProviderAttempt.findUnique({
    where: { id: identity.id },
    select: {
      sequence: true,
      turnId: true,
      runtimeAttempt: true,
      providerKey: true,
      modelKey: true,
      status: true,
      providerStatus: true,
      providerRequestId: true,
      providerGenerationId: true,
      failure: true,
    },
  })
  if (
    stored
    && stored.sequence === identity.sequence
    && stored.turnId === identity.turnId
    && stored.runtimeAttempt === identity.runtimeAttempt
    && stored.providerKey === identity.providerKey
    && stored.modelKey === identity.modelKey
    && sameStoredTerminal(stored, terminal)
  ) return
  throw new Error('CODEX_PROVIDER_ATTEMPT_TERMINAL_DIVERGED')
}

export async function succeedCodexProviderAttempt(
  identity: CodexProviderAttemptIdentity,
  input: {
    readonly providerStatus: number
    readonly providerRequestId?: string | null
    readonly providerGenerationId?: string | null
  },
): Promise<void> {
  await settleCodexProviderAttempt(identity, { status: 'succeeded', ...input })
}

export async function failCodexProviderAttempt(
  identity: CodexProviderAttemptIdentity,
  input: {
    readonly failure: FailureRecord
    readonly providerStatus?: number | null
    readonly providerRequestId?: string | null
    readonly providerGenerationId?: string | null
  },
): Promise<void> {
  await settleCodexProviderAttempt(identity, { status: 'failed', ...input })
}

export async function cancelCodexProviderAttempt(
  identity: CodexProviderAttemptIdentity,
  input: {
    readonly providerStatus?: number | null
    readonly providerRequestId?: string | null
    readonly providerGenerationId?: string | null
  } = {},
): Promise<void> {
  await settleCodexProviderAttempt(identity, { status: 'cancelled', ...input })
}
