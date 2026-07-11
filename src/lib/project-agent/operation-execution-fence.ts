import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentRunFence } from './run-fence'
import type { ProjectAgentOperationTaskBatchBinding } from '@/lib/operations/types'
import { parseProjectAgentChoiceOffer } from './choice-offer'

export interface ProjectAgentChoiceExecutionOutcome {
  interruptionId: string
  cardId: string
  toolCallId: string
  choiceType: string
}

export function resolveProjectAgentOperationPostInvocationStatus(input: {
  agentFlow?: { interruptsFor?: 'approval' | 'choice' | null } | null
}): 'running' | 'awaiting_choice' {
  return input.agentFlow?.interruptsFor === 'choice' ? 'awaiting_choice' : 'running'
}

export interface ProjectAgentOperationExecutionFence {
  runFence: ProjectAgentRunFence
  signal: AbortSignal
  continuationClaim?: {
    waitId: string
    commandId: string
    claimOwner: string
  } | null
  taskBatchBinding?: ProjectAgentOperationTaskBatchBinding | null
  choiceExecutionOutcome?: ProjectAgentChoiceExecutionOutcome | null
}

export class ProjectAgentOperationExecutionFenceError extends Error {
  constructor(params: {
    runId: string
    reason: 'aborted' | 'run_not_running' | 'stale_run_fence' | 'continuation_claim_lost'
    cause?: unknown
  }) {
    super(`PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REJECTED runId=${params.runId} reason=${params.reason}`, {
      cause: params.cause,
    })
    this.name = 'ProjectAgentOperationExecutionFenceError'
  }
}

const operationExecutionFenceStorage = new AsyncLocalStorage<ProjectAgentOperationExecutionFence>()

function assertNotAborted(fence: ProjectAgentOperationExecutionFence): void {
  if (!fence.signal.aborted) return
  throw new ProjectAgentOperationExecutionFenceError({
    runId: fence.runFence.runId,
    reason: 'aborted',
    cause: fence.signal.reason,
  })
}

function assertRunSnapshot(params: {
  fence: ProjectAgentOperationExecutionFence
  run: {
    status: string
    runVersion: number
    eventSeq: bigint
  } | null
  expectedStatus?: 'running' | 'awaiting_choice'
}): void {
  const expectedStatus = params.expectedStatus ?? 'running'
  if (!params.run || params.run.status !== expectedStatus) {
    throw new ProjectAgentOperationExecutionFenceError({
      runId: params.fence.runFence.runId,
      reason: 'run_not_running',
    })
  }
  if (
    params.run.runVersion !== params.fence.runFence.runVersion
    || params.run.eventSeq.toString() !== params.fence.runFence.eventSeq
  ) {
    throw new ProjectAgentOperationExecutionFenceError({
      runId: params.fence.runFence.runId,
      reason: 'stale_run_fence',
    })
  }
}

export async function runWithProjectAgentOperationExecutionFence<T>(
  fence: ProjectAgentOperationExecutionFence,
  work: () => Promise<T>,
): Promise<T> {
  return await operationExecutionFenceStorage.run(fence, work)
}

export function getProjectAgentOperationExecutionFence(): ProjectAgentOperationExecutionFence | null {
  return operationExecutionFenceStorage.getStore() ?? null
}

/**
 * Records the durable Interaction created by the current Operation invocation.
 * This is intentionally bound only after the Choice transaction commits. The
 * post-invocation fence can then distinguish this invocation's legal
 * `running -> awaiting_choice` transition from an external state change.
 */
export function recordProjectAgentChoiceExecutionOutcome(
  outcome: ProjectAgentChoiceExecutionOutcome & { runId: string },
): void {
  const fence = getProjectAgentOperationExecutionFence()
  if (!fence) return
  if (fence.runFence.runId !== outcome.runId) {
    throw new ProjectAgentOperationExecutionFenceError({
      runId: fence.runFence.runId,
      reason: 'stale_run_fence',
    })
  }
  const next: ProjectAgentChoiceExecutionOutcome = {
    interruptionId: outcome.interruptionId,
    cardId: outcome.cardId,
    toolCallId: outcome.toolCallId,
    choiceType: outcome.choiceType,
  }
  const current = fence.choiceExecutionOutcome
  if (
    current
    && (
      current.interruptionId !== next.interruptionId
      || current.cardId !== next.cardId
      || current.toolCallId !== next.toolCallId
      || current.choiceType !== next.choiceType
    )
  ) {
    throw new Error(`PROJECT_AGENT_OPERATION_CHOICE_OUTCOME_CONFLICT:${fence.runFence.runId}`)
  }
  fence.choiceExecutionOutcome = next
}

export async function assertProjectAgentOperationExecutionFenceCurrent(
  fence: ProjectAgentOperationExecutionFence,
): Promise<void> {
  assertNotAborted(fence)
  const run = await prisma.projectAgentRun.findUnique({
    where: { id: fence.runFence.runId },
    select: {
      status: true,
      runVersion: true,
      eventSeq: true,
    },
  })
  assertRunSnapshot({ fence, run })
  assertNotAborted(fence)
}

export async function assertProjectAgentOperationExecutionFenceAfterInvocation(
  fence: ProjectAgentOperationExecutionFence,
): Promise<void> {
  assertNotAborted(fence)
  const run = await prisma.projectAgentRun.findUnique({
    where: { id: fence.runFence.runId },
    select: {
      status: true,
      runVersion: true,
      eventSeq: true,
    },
  })
  assertRunSnapshot({ fence, run })
  assertNotAborted(fence)
}

/**
 * A Choice Operation is not a domain write, but it is a durable Run-lifecycle
 * write. Accept only the exact pending Interaction that this invocation
 * committed under the advanced fence; never accept a generic awaiting_choice
 * state as a fallback.
 */
export async function assertProjectAgentChoiceExecutionFenceAfterInvocation(params: {
  fence: ProjectAgentOperationExecutionFence
  projectId: string
  userId: string
  episodeId: string | null
  assistantId: string
  operationId: string
}): Promise<void> {
  const { fence } = params
  const outcome = fence.choiceExecutionOutcome
  if (!outcome) {
    throw new Error(`PROJECT_AGENT_OPERATION_CHOICE_OUTCOME_MISSING:${params.operationId}`)
  }
  assertNotAborted(fence)
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      status: string
      runVersion: number
      eventSeq: bigint
    }>>(Prisma.sql`
      SELECT status, runVersion, eventSeq
      FROM project_agent_runs
      WHERE id = ${fence.runFence.runId}
      FOR UPDATE
    `)
    assertRunSnapshot({
      fence,
      run: rows[0] ?? null,
      expectedStatus: 'awaiting_choice',
    })
    const interruption = await tx.projectAgentInterruption.findFirst({
      where: {
        id: outcome.interruptionId,
        runId: fence.runFence.runId,
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId,
        assistantId: params.assistantId,
        type: 'choice',
        status: 'pending',
        operationId: params.operationId,
        toolCallId: outcome.toolCallId,
      },
      select: {
        activityId: true,
        payload: true,
      },
    })
    if (!interruption?.activityId) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHOICE_OUTCOME_INVALID:${params.operationId}`)
    }
    const offer = parseProjectAgentChoiceOffer(interruption.payload)
    if (
      offer.card.runId !== fence.runFence.runId
      || offer.card.interruptionId !== outcome.interruptionId
      || offer.card.cardId !== outcome.cardId
      || offer.card.toolCallId !== outcome.toolCallId
      || offer.card.choiceType !== outcome.choiceType
    ) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHOICE_OFFER_MISMATCH:${params.operationId}`)
    }
    const activity = await tx.projectAgentActivity.findFirst({
      where: {
        id: interruption.activityId,
        runId: fence.runFence.runId,
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId,
        assistantId: params.assistantId,
        type: 'awaiting_choice',
        status: 'waiting',
        operationId: params.operationId,
        toolCallId: outcome.toolCallId,
        choiceType: outcome.choiceType,
      },
      select: { id: true },
    })
    if (!activity) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHOICE_ACTIVITY_MISMATCH:${params.operationId}`)
    }
  })
  assertNotAborted(fence)
}

/**
 * Final domain-commit barrier for Assistant operations. The row lock makes
 * the Run fence validation and the caller's domain writes one serialized DB
 * decision. The AbortSignal is checked on both sides of the lock so a
 * heartbeat/lock/continuation-claim loss observed while the transaction is
 * open rolls the whole transaction back.
 */
export async function assertProjectAgentOperationExecutionFenceInTransaction(
  tx: Prisma.TransactionClient,
  fence: ProjectAgentOperationExecutionFence,
): Promise<void> {
  assertNotAborted(fence)
  const rows = await tx.$queryRaw<Array<{
    status: string
    runVersion: number
    eventSeq: bigint
  }>>(Prisma.sql`
    SELECT status, runVersion, eventSeq
    FROM project_agent_runs
    WHERE id = ${fence.runFence.runId}
    FOR UPDATE
  `)
  assertRunSnapshot({
    fence,
    run: rows[0] ?? null,
  })
  if (fence.continuationClaim) {
    const claims = await tx.$queryRaw<Array<{
      runId: string
      status: string
      followUpCommandId: string | null
      claimId: string | null
      claimExpiresAt: Date | null
      followedAt: Date | null
    }>>(Prisma.sql`
      SELECT runId, status, followUpCommandId, claimId, claimExpiresAt, followedAt
      FROM project_agent_waits
      WHERE id = ${fence.continuationClaim.waitId}
      FOR UPDATE
    `)
    const claim = claims[0] ?? null
    if (
      !claim
      || claim.runId !== fence.runFence.runId
      || claim.status !== 'claimed'
      || claim.followUpCommandId !== fence.continuationClaim.commandId
      || claim.claimId !== fence.continuationClaim.claimOwner
      || !claim.claimExpiresAt
      || claim.claimExpiresAt.getTime() <= Date.now()
      || claim.followedAt !== null
    ) {
      throw new ProjectAgentOperationExecutionFenceError({
        runId: fence.runFence.runId,
        reason: 'continuation_claim_lost',
      })
    }
  }
  assertNotAborted(fence)
}
