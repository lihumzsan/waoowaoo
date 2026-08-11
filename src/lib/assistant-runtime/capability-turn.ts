import { hasAssistantRuntimeOwnership } from '@/lib/assistant-runtime/runtime-ownership'
import { prisma } from '@/lib/prisma'
import { bindAssistantRuntimeTurn } from './persistence'

const CAPABILITY_TURN_STATUSES = ['running', 'waiting_approval'] as const

export type AssistantRuntimeCapabilityTurnErrorCode =
  | 'OWNERSHIP_REQUIRED'
  | 'ACTIVE_TURN_NOT_FOUND'
  | 'ACTIVE_TURN_AMBIGUOUS'
  | 'ACTIVE_TURN_IDENTITY_INVALID'

export class AssistantRuntimeCapabilityTurnError extends Error {
  readonly code: AssistantRuntimeCapabilityTurnErrorCode

  constructor(code: AssistantRuntimeCapabilityTurnErrorCode) {
    super(`ASSISTANT_RUNTIME_CAPABILITY_TURN_${code}`)
    this.name = 'AssistantRuntimeCapabilityTurnError'
    this.code = code
  }
}

export type AssistantRuntimeCapabilityTurn = {
  readonly threadId: string
  readonly turnId: string
  readonly requestId: string
  readonly runtimeTurnId: string
  readonly executionOwnerId: string
  readonly attempt: number
  readonly contextJson: unknown
}

type AssistantRuntimeCapabilityTurnCandidate = {
  readonly id: string
  readonly requestId: string
  readonly executionOwnerId: string | null
  readonly contextJson: unknown
  readonly threadId: string
  readonly runtimeTurnId: string | null
  readonly attempt: number
  readonly thread: { readonly id: string }
}

function requireIdentity(value: string | null): string {
  if (!value || value !== value.trim()) {
    throw new AssistantRuntimeCapabilityTurnError('ACTIVE_TURN_IDENTITY_INVALID')
  }
  return value
}

async function requireOwnership(input: {
  readonly scope: {
    readonly userId: string
    readonly projectId: string
    readonly assistantId: string
  }
  readonly ownerToken: string
}): Promise<void> {
  if (!await hasAssistantRuntimeOwnership(input.scope, input.ownerToken)) {
    throw new AssistantRuntimeCapabilityTurnError('OWNERSHIP_REQUIRED')
  }
}

async function readCapabilityTurn(input: {
  readonly scope: {
    readonly userId: string
    readonly projectId: string
    readonly assistantId: string
  }
}): Promise<AssistantRuntimeCapabilityTurnCandidate> {
  const turns = await prisma.projectAgentTurn.findMany({
    where: {
      projectId: input.scope.projectId,
      userId: input.scope.userId,
      status: { in: [...CAPABILITY_TURN_STATUSES] },
      cancelRequestId: null,
      thread: {
        projectId: input.scope.projectId,
        userId: input.scope.userId,
        assistantId: input.scope.assistantId,
        clearRequestId: null,
      },
    },
    select: {
      id: true,
      requestId: true,
      executionOwnerId: true,
      contextJson: true,
      threadId: true,
      runtimeTurnId: true,
      attempt: true,
      thread: { select: { id: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 2,
  })
  if (turns.length === 0) {
    throw new AssistantRuntimeCapabilityTurnError('ACTIVE_TURN_NOT_FOUND')
  }
  if (turns.length !== 1) {
    throw new AssistantRuntimeCapabilityTurnError('ACTIVE_TURN_AMBIGUOUS')
  }
  const turn = turns[0]
  if (!turn) {
    throw new AssistantRuntimeCapabilityTurnError('ACTIVE_TURN_NOT_FOUND')
  }
  return turn
}

function projectCapabilityTurn(
  turn: AssistantRuntimeCapabilityTurnCandidate,
): AssistantRuntimeCapabilityTurn {
  const runtimeTurnId = requireIdentity(turn.runtimeTurnId)
  const executionOwnerId = requireIdentity(turn.executionOwnerId)
  if (
    runtimeTurnId !== executionOwnerId
    || turn.threadId !== turn.thread.id
  ) {
    throw new AssistantRuntimeCapabilityTurnError('ACTIVE_TURN_IDENTITY_INVALID')
  }
  return {
    threadId: turn.threadId,
    turnId: turn.id,
    requestId: requireIdentity(turn.requestId),
    runtimeTurnId,
    executionOwnerId,
    attempt: turn.attempt,
    contextJson: turn.contextJson,
  }
}

/**
 * The sole execution fence shared by every capability exposed to Codex.
 *
 * `runtimeThreadId` is intentionally absent because native Thread persistence
 * identifies conversation history, not permission to execute product effects.
 * The live owner token plus the bound product Turn remains the only fence.
 */
export async function requireAssistantRuntimeCapabilityTurn(input: {
  readonly scope: {
    readonly userId: string
    readonly projectId: string
    readonly assistantId: string
  }
  readonly ownerToken: string
}): Promise<AssistantRuntimeCapabilityTurn> {
  await requireOwnership(input)
  return projectCapabilityTurn(await readCapabilityTurn(input))
}

/**
 * Model sampling can begin immediately after Codex allocates the native Turn,
 * before the app-server `turn/start` response continuation has persisted that
 * identity. The authenticated model request carries the canonical native Turn
 * id, so it may complete the same authoritative binding before the gateway
 * spends money. Side-effect capabilities continue to require the already-bound
 * path above.
 */
export async function requireAssistantRuntimeModelCapabilityTurn(input: {
  readonly scope: {
    readonly userId: string
    readonly projectId: string
    readonly assistantId: string
  }
  readonly ownerToken: string
  readonly runtimeTurnId: string
}): Promise<AssistantRuntimeCapabilityTurn> {
  const requestedRuntimeTurnId = requireIdentity(input.runtimeTurnId)
  await requireOwnership(input)
  let turn = await readCapabilityTurn(input)
  if (turn.runtimeTurnId === null && turn.executionOwnerId === null) {
    await bindAssistantRuntimeTurn({
      scope: input.scope,
      threadId: turn.threadId,
      turnId: turn.id,
      runtimeTurnId: requestedRuntimeTurnId,
    })
    turn = await readCapabilityTurn(input)
  }
  const projected = projectCapabilityTurn(turn)
  if (projected.runtimeTurnId !== requestedRuntimeTurnId) {
    throw new AssistantRuntimeCapabilityTurnError('ACTIVE_TURN_IDENTITY_INVALID')
  }
  return projected
}
