import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentRunFence } from './run-fence'
import type { ProjectAgentOperationTaskBatchBinding } from '@/lib/operations/types'
import {
  assertProjectAgentSuspensionReceipt,
  isSameProjectAgentSuspensionReceipt,
  type ProjectAgentSuspensionKind,
  type ProjectAgentSuspensionReceipt,
} from './suspension'

export interface ProjectAgentOperationExecutionFence {
  runFence: ProjectAgentRunFence
  signal: AbortSignal
  continuationClaim?: {
    waitId: string
    commandId: string
    claimOwner: string
  } | null
  taskBatchBinding?: ProjectAgentOperationTaskBatchBinding | null
  /**
   * In-memory committed receipt for this one invocation. It is never a
   * substitute for persisted Interaction/Wait facts; it merely prevents an
   * operation from reporting a suspension that it did not commit.
   */
  suspensionReceipt?: ProjectAgentSuspensionReceipt | null
}

export class ProjectAgentOperationExecutionFenceError extends Error {
  constructor(params: {
    runId: string
    reason: 'aborted' | 'run_missing' | 'stale_run_fence' | 'continuation_claim_lost'
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

/**
 * For a transaction that legitimately advances the Run fence itself, callers
 * cannot re-run the version check after writing their own Event. They still
 * must check the shared ownership signal before committing so lock loss rolls
 * the transaction back instead of leaving a late suspension behind.
 */
export function assertProjectAgentOperationExecutionFenceSignal(
  fence: ProjectAgentOperationExecutionFence,
): void {
  assertNotAborted(fence)
}

function assertRunSnapshot(params: {
  fence: ProjectAgentOperationExecutionFence
  run: {
    runVersion: number
    eventSeq: bigint
  } | null
}): void {
  if (!params.run) {
    throw new ProjectAgentOperationExecutionFenceError({
      runId: params.fence.runFence.runId,
      reason: 'run_missing',
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
 * Records the committed protocol handoff created by the current Operation
 * invocation. A receipt is only allowed after the protocol's own transaction
 * has committed. Execution eligibility remains a pre-commit fence concern;
 * this function never interprets a Run status.
 */
export function recordProjectAgentSuspensionReceipt(
  receipt: ProjectAgentSuspensionReceipt,
): void {
  const fence = getProjectAgentOperationExecutionFence()
  if (!fence) return
  assertProjectAgentSuspensionReceipt({
    receipt,
    runId: fence.runFence.runId,
  })
  const current = fence.suspensionReceipt
  if (current) {
    if (!isSameProjectAgentSuspensionReceipt(current, receipt)) {
      throw new Error(`PROJECT_AGENT_OPERATION_SUSPENSION_RECEIPT_CONFLICT:${fence.runFence.runId}`)
    }
    return
  }
  fence.suspensionReceipt = receipt
}

/**
 * An operation may declare a suspension protocol. Its result is accepted only
 * if the current invocation committed a receipt of that exact protocol and
 * operation. This is deliberately independent of `Run.status`: a legal
 * suspension advances the Run to awaiting_* as part of its own transaction.
 */
export function requireProjectAgentSuspensionReceipt(params: {
  fence: ProjectAgentOperationExecutionFence
  kind: ProjectAgentSuspensionKind
  operationId: string
}): ProjectAgentSuspensionReceipt {
  const receipt = params.fence.suspensionReceipt
  if (!receipt) {
    throw new Error(`PROJECT_AGENT_SUSPENSION_RECEIPT_MISSING:${params.operationId}:${params.kind}`)
  }
  assertProjectAgentSuspensionReceipt({
    receipt,
    runId: params.fence.runFence.runId,
    kind: params.kind,
    operationId: params.operationId,
  })
  return receipt
}

export async function assertProjectAgentOperationExecutionFenceCurrent(
  fence: ProjectAgentOperationExecutionFence,
): Promise<void> {
  assertNotAborted(fence)
  const run = await prisma.projectAgentRun.findUnique({
    where: { id: fence.runFence.runId },
    select: {
      runVersion: true,
      eventSeq: true,
    },
  })
  assertRunSnapshot({ fence, run })
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
    runVersion: number
    eventSeq: bigint
  }>>(Prisma.sql`
    SELECT runVersion, eventSeq
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
