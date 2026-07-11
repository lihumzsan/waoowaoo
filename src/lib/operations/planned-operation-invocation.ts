import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentOperationContext, ProjectAgentOperationDefinition } from './types'
import { loadOperationPlanSnapshot } from './operation-plan-snapshot'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { assertProjectAgentOperationExecutionFenceInTransaction } from '@/lib/project-agent/operation-execution-fence'

const EXECUTION_CONTRACT_VERSION = 1
const APPROVED_OPERATION_TRANSACTION_TIMEOUT_MS = 60_000

export interface PlannedOperationInvocation {
  approvalGrantId: string
  requestId: string
}

export interface OperationExecutionAuthorization {
  approvalGrantId: string
  operationExecutionId: string
  transaction: Prisma.TransactionClient
}

export function requireOperationExecutionTransaction(ctx: ProjectAgentOperationContext): Prisma.TransactionClient {
  const transaction = ctx.executionAuthorization?.transaction
  if (!transaction) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_EXECUTION_TRANSACTION_REQUIRED',
    })
  }
  return transaction
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function splitPlannedOperationInvocation(input: unknown): {
  invocation: PlannedOperationInvocation | null
  businessInput: unknown
} {
  if (!isRecord(input)) return { invocation: null, businessInput: input }
  if ('confirmed' in input || 'confirmedMaxCost' in input) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'LEGACY_OPERATION_CONFIRMATION_UNSUPPORTED',
      message: 'boolean operation confirmation is not accepted; approve the immutable plan snapshot',
    })
  }
  const approvalGrantId = input.approvalGrantId
  const requestId = input.operationRequestId
  const businessInput = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'approvalGrantId' && key !== 'operationRequestId'),
  )
  if (approvalGrantId === undefined && requestId === undefined) {
    return { invocation: null, businessInput }
  }
  if (typeof approvalGrantId !== 'string' || !approvalGrantId.trim() || typeof requestId !== 'string' || !requestId.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_PLAN_INVOCATION_INVALID',
      message: 'approvalGrantId and operationRequestId are both required',
    })
  }
  return {
    invocation: {
      approvalGrantId: approvalGrantId.trim(),
      requestId: requestId.trim(),
    },
    businessInput,
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('OPERATION_EXECUTION_OUTPUT_NOT_JSON')
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function issueApprovalGrant(params: {
  userId: string
  planSnapshotId: string
  requestId: string
}): Promise<{ approvalGrantId: string; operationRequestId: string }> {
  const snapshot = await loadOperationPlanSnapshot(params.planSnapshotId)
  if (!snapshot)
    throw new ApiError('NOT_FOUND', {
      code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND',
    })
  if (snapshot.userId !== params.userId) {
    throw new ApiError('FORBIDDEN', { code: 'OPERATION_PLAN_SCOPE_MISMATCH' })
  }
  if (snapshot.expiresAt.getTime() <= Date.now()) {
    throw new ApiError('CONFLICT', { code: 'OPERATION_PLAN_EXPIRED' })
  }
  const existing = await prisma.approvalGrant.findUnique({
    where: { planSnapshotId: snapshot.id },
  })
  if (existing) {
    if (existing.userId !== params.userId || existing.revokedAt || existing.expiresAt.getTime() <= Date.now()) {
      throw new ApiError('CONFLICT', { code: 'APPROVAL_GRANT_NOT_USABLE' })
    }
    return {
      approvalGrantId: existing.id,
      operationRequestId: existing.requestId,
    }
  }
  try {
    const grant = await prisma.approvalGrant.create({
      data: {
        id: randomUUID(),
        contractVersion: EXECUTION_CONTRACT_VERSION,
        userId: snapshot.userId,
        scopeKind: snapshot.scopeKind,
        scopeId: snapshot.scopeId,
        projectId: snapshot.projectId,
        episodeId: snapshot.episodeId,
        operationId: snapshot.operationId,
        planSnapshotId: snapshot.id,
        requestId: params.requestId,
        inputHash: snapshot.inputHash,
        planHash: snapshot.planHash,
        quoteHash: snapshot.quoteHash,
        quoteCeiling: snapshot.quote.totalMaxFrozenCost ?? null,
        currency: snapshot.quote.currency ?? null,
        expiresAt: snapshot.expiresAt,
      },
    })
    return { approvalGrantId: grant.id, operationRequestId: grant.requestId }
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const raced = await prisma.approvalGrant.findUnique({
      where: { planSnapshotId: snapshot.id },
    })
    if (!raced) throw error
    return { approvalGrantId: raced.id, operationRequestId: raced.requestId }
  }
}

function assertSnapshotScope(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  operationId: string
  normalizedInput: unknown
  snapshot: NonNullable<Awaited<ReturnType<typeof loadOperationPlanSnapshot>>>
  allowExpired: boolean
}): void {
  const expectedScopeKind = params.projectId === 'global-asset-hub' ? 'global_asset_hub' : 'project'
  const expectedEpisodeId = params.episodeId ?? null
  if (params.snapshot.contractVersion !== EXECUTION_CONTRACT_VERSION) {
    throw new ApiError('CONFLICT', {
      code: 'OPERATION_PLAN_CONTRACT_VERSION_MISMATCH',
    })
  }
  if (
    params.snapshot.userId !== params.userId ||
    params.snapshot.scopeKind !== expectedScopeKind ||
    params.snapshot.scopeId !== params.projectId ||
    params.snapshot.operationId !== params.operationId ||
    params.snapshot.episodeId !== expectedEpisodeId
  ) {
    throw new ApiError('FORBIDDEN', {
      code: 'OPERATION_PLAN_SCOPE_MISMATCH',
      message: 'the approved plan does not belong to this user, scope, episode, or operation',
    })
  }
  if (!params.allowExpired && params.snapshot.expiresAt.getTime() <= Date.now()) {
    throw new ApiError('CONFLICT', {
      code: 'OPERATION_PLAN_EXPIRED',
      message: 'the approved operation plan has expired',
    })
  }
  if (hashCanonicalJson(params.normalizedInput) !== params.snapshot.inputHash) {
    throw new ApiError('CONFLICT', {
      code: 'OPERATION_PLAN_INPUT_CHANGED',
      message: 'the operation input differs from the approved immutable plan',
    })
  }
}

async function lockApprovalGrant(tx: Prisma.TransactionClient, approvalGrantId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM approval_grants
    WHERE id = ${approvalGrantId}
    FOR UPDATE
  `)
  if (rows.length !== 1) {
    throw new ApiError('NOT_FOUND', { code: 'APPROVAL_GRANT_NOT_FOUND' })
  }
}

function assertGrantMatchesSnapshot(params: {
  grant: {
    id: string
    requestId: string
    inputHash: string
    planHash: string
    quoteHash: string
    revokedAt: Date | null
    expiresAt: Date
    consumedExecutionId: string | null
  }
  requestId: string
  snapshot: NonNullable<Awaited<ReturnType<typeof loadOperationPlanSnapshot>>>
}): void {
  if (params.grant.requestId !== params.requestId) {
    throw new ApiError('FORBIDDEN', {
      code: 'APPROVAL_GRANT_REQUEST_MISMATCH',
    })
  }
  if (
    params.grant.inputHash !== params.snapshot.inputHash ||
    params.grant.planHash !== params.snapshot.planHash ||
    params.grant.quoteHash !== params.snapshot.quoteHash ||
    params.grant.revokedAt ||
    (params.grant.expiresAt.getTime() <= Date.now() && !params.grant.consumedExecutionId)
  ) {
    throw new ApiError('CONFLICT', { code: 'APPROVAL_GRANT_NOT_USABLE' })
  }
}

export async function invokeApprovedOperationPlan<Input, Output>(params: {
  operation: ProjectAgentOperationDefinition<Input, Output>
  ctx: ProjectAgentOperationContext
  normalizedInput: Input
  invocation: PlannedOperationInvocation
}): Promise<Output> {
  if (params.operation.confirmation.kind !== 'billable_media') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'APPROVAL_GRANT_NOT_APPLICABLE',
    })
  }
  if (!params.operation.plan || !params.operation.commit) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BILLABLE_OPERATION_PLAN_COMMIT_REQUIRED',
      operationId: params.operation.id,
    })
  }
  const commit = params.operation.commit
  type OperationWriter = NonNullable<ProjectAgentOperationContext['writer']>
  type BufferedOperationPart = Parameters<OperationWriter['write']>[0]
  const bufferedParts: BufferedOperationPart[] = []
  const bufferedWriter = {
    write(part: BufferedOperationPart) {
      bufferedParts.push(part)
    },
  } as OperationWriter
  const output = await prisma.$transaction(
    async (tx) => {
      if (params.ctx.executionFence) {
        await assertProjectAgentOperationExecutionFenceInTransaction(tx, params.ctx.executionFence)
      }
      await lockApprovalGrant(tx, params.invocation.approvalGrantId)
      const grant = await tx.approvalGrant.findUnique({
        where: { id: params.invocation.approvalGrantId },
      })
      if (!grant) throw new ApiError('NOT_FOUND', { code: 'APPROVAL_GRANT_NOT_FOUND' })
      const snapshot = await loadOperationPlanSnapshot(grant.planSnapshotId, tx)
      if (!snapshot)
        throw new ApiError('NOT_FOUND', {
          code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND',
        })
      assertGrantMatchesSnapshot({
        grant,
        requestId: params.invocation.requestId,
        snapshot,
      })
      assertSnapshotScope({
        userId: params.ctx.userId,
        projectId: params.ctx.projectId,
        episodeId: params.ctx.context.episodeId ?? null,
        operationId: params.operation.id,
        normalizedInput: params.normalizedInput,
        snapshot,
        allowExpired: Boolean(grant.consumedExecutionId),
      })

      const existing = await tx.operationExecution.findUnique({
        where: { approvalGrantId: grant.id },
      })
      if (existing) {
        if (existing.status !== 'completed' || existing.output === null) {
          throw new Error(`OPERATION_EXECUTION_DURABLE_INTERMEDIATE_STATE:${existing.id}:${existing.status}`)
        }
        if (params.ctx.executionFence) {
          await assertProjectAgentOperationExecutionFenceInTransaction(tx, params.ctx.executionFence)
        }
        return existing.output as Output
      }
      if (grant.consumedAt || grant.consumedExecutionId) {
        throw new Error(`APPROVAL_GRANT_CONSUMED_WITHOUT_EXECUTION:${grant.id}`)
      }

      const execution = await tx.operationExecution.create({
        data: {
          id: randomUUID(),
          contractVersion: EXECUTION_CONTRACT_VERSION,
          userId: snapshot.userId,
          scopeKind: snapshot.scopeKind,
          scopeId: snapshot.scopeId,
          projectId: snapshot.projectId,
          episodeId: snapshot.episodeId,
          operationId: snapshot.operationId,
          planSnapshotId: snapshot.id,
          approvalGrantId: grant.id,
          requestId: params.invocation.requestId,
          status: 'committing',
        },
      })
      const consumed = await tx.approvalGrant.updateMany({
        where: {
          id: grant.id,
          version: 0,
          consumedAt: null,
          consumedExecutionId: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          consumedAt: new Date(),
          consumedExecutionId: execution.id,
          version: { increment: 1 },
        },
      })
      if (consumed.count !== 1) {
        throw new Error(`APPROVAL_GRANT_CONSUME_RACED:${grant.id}`)
      }
      const committedOutput = await commit(
        {
          ...params.ctx,
          writer: bufferedWriter,
          executionAuthorization: {
            approvalGrantId: grant.id,
            operationExecutionId: execution.id,
            transaction: tx,
          },
        },
        params.normalizedInput,
        snapshot.plan,
      )

      const parsedOutput = params.operation.outputSchema.safeParse(committedOutput)
      if (!parsedOutput.success) {
        throw new ApiError('EXTERNAL_ERROR', {
          code: 'OPERATION_OUTPUT_INVALID',
          message: `operation output schema mismatch: ${params.operation.id}`,
          issues: parsedOutput.error.issues,
        })
      }
      const output = parsedOutput.data
      const tasks = await tx.task.findMany({
        where: { operationExecutionId: execution.id },
        select: { id: true },
      })
      const [consumedGrant, enqueueCommands] = await Promise.all([
        tx.approvalGrant.findUnique({ where: { id: grant.id } }),
        tx.outboxCommand.count({
          where: {
            kind: 'task.enqueue',
            aggregateType: 'task',
            aggregateId: { in: tasks.map((task) => task.id) },
          },
        }),
      ])
      if (
        !consumedGrant?.consumedAt ||
        consumedGrant.consumedExecutionId !== execution.id ||
        tasks.length !== snapshot.plan.tasks.length ||
        enqueueCommands !== snapshot.plan.tasks.length
      ) {
        throw new Error(`OPERATION_PLAN_ATOMIC_COMMIT_INCOMPLETE:${execution.id}`)
      }
      if (params.ctx.executionFence) {
        await assertProjectAgentOperationExecutionFenceInTransaction(tx, params.ctx.executionFence)
      }
      await params.ctx.taskBatchBinding?.bindInTransaction(tx, {
        operationId: params.operation.id,
        taskIds: tasks.map((task) => task.id),
      })
      await tx.operationExecution.update({
        where: { id: execution.id },
        data: {
          status: 'completed',
          output: toJson(output),
          completedAt: new Date(),
        },
      })
      if (params.ctx.executionFence && !params.ctx.taskBatchBinding?.isBound()) {
        await assertProjectAgentOperationExecutionFenceInTransaction(tx, params.ctx.executionFence)
      }
      return output
    },
    {
      maxWait: 10_000,
      timeout: APPROVED_OPERATION_TRANSACTION_TIMEOUT_MS,
    },
  )
  params.ctx.taskBatchBinding?.markCommitted()
  for (const part of bufferedParts) {
    params.ctx.writer?.write(part)
  }
  return output
}
