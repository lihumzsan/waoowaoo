import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentRunFence } from './run-fence'
import type { ProjectAgentOperationTaskBatchBinding } from '@/lib/operations/types'

export interface ProjectAgentOperationExecutionFence {
  runFence: ProjectAgentRunFence
  signal: AbortSignal
  continuationClaim?: {
    waitId: string
    commandId: string
    claimOwner: string
  } | null
  taskBatchBinding?: ProjectAgentOperationTaskBatchBinding | null
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
}): void {
  if (!params.run || params.run.status !== 'running') {
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
