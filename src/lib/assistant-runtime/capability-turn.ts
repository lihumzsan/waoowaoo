import { hasAssistantRuntimeOwnership } from '@/lib/assistant-runtime/runtime-ownership'
import { prisma } from '@/lib/prisma'

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
  readonly contextJson: unknown
}

function requireIdentity(value: string | null): string {
  if (!value || value !== value.trim()) {
    throw new AssistantRuntimeCapabilityTurnError('ACTIVE_TURN_IDENTITY_INVALID')
  }
  return value
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
  if (!await hasAssistantRuntimeOwnership(input.scope, input.ownerToken)) {
    throw new AssistantRuntimeCapabilityTurnError('OWNERSHIP_REQUIRED')
  }
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
    contextJson: turn.contextJson,
  }
}
