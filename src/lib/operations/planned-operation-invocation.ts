import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentOperationContext, ProjectAgentOperationDefinition } from './types'
import { loadOperationPlanSnapshot } from './operation-plan-snapshot'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { assertProjectAgentOperationExecutionFenceInTransaction } from '@/lib/project-agent/operation-execution-fence'
import {
  buildCurrentOperationPlanArtifactHashes,
  changedOperationPlanArtifacts,
} from './operation-plan-revalidation'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

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

export interface ApprovalGrantRequest {
  planSnapshotId: string
  requestId: string
}

export interface IssuedApprovalGrant extends PlannedOperationInvocation {
  planSnapshotId: string
  operationId: string
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

export async function issueApprovalGrantGroup(params: {
  userId: string
  requests: readonly ApprovalGrantRequest[]
}): Promise<IssuedApprovalGrant[]> {
  if (params.requests.length === 0) return []
  const planSnapshotIds = params.requests.map((request) => request.planSnapshotId.trim())
  if (planSnapshotIds.some((id) => !id) || new Set(planSnapshotIds).size !== planSnapshotIds.length) {
    throw new ApiError('INVALID_PARAMS', { code: 'APPROVAL_GROUP_PLAN_SNAPSHOT_INVALID' })
  }
  return await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM operation_plan_snapshots
      WHERE id IN (${Prisma.join([...planSnapshotIds].sort())})
      ORDER BY id
      FOR UPDATE
    `)
    if (locked.length !== planSnapshotIds.length) {
      throw new ApiError('NOT_FOUND', { code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND' })
    }
    const issued: IssuedApprovalGrant[] = []
    for (const request of params.requests) {
      const snapshot = await loadOperationPlanSnapshot(request.planSnapshotId, tx)
      if (!snapshot) {
        throw new ApiError('NOT_FOUND', { code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND' })
      }
      if (snapshot.userId !== params.userId) {
        throw new ApiError('FORBIDDEN', { code: 'OPERATION_PLAN_SCOPE_MISMATCH' })
      }
      const existing = await tx.approvalGrant.findUnique({
        where: { planSnapshotId: snapshot.id },
      })
      if (existing) {
        if (existing.userId !== params.userId || existing.revokedAt) {
          throw new ApiError('CONFLICT', { code: 'APPROVAL_GRANT_NOT_USABLE' })
        }
        issued.push({
          planSnapshotId: snapshot.id,
          operationId: snapshot.operationId,
          approvalGrantId: existing.id,
          requestId: existing.requestId,
        })
        continue
      }
      const grant = await tx.approvalGrant.create({
        data: {
          id: randomUUID(),
          userId: snapshot.userId,
          scopeKind: snapshot.scopeKind,
          scopeId: snapshot.scopeId,
          projectId: snapshot.projectId,
          episodeId: snapshot.episodeId,
          operationId: snapshot.operationId,
          planSnapshotId: snapshot.id,
          requestId: request.requestId,
          inputHash: snapshot.inputHash,
          planHash: snapshot.planHash,
          quoteHash: snapshot.quoteHash,
          quoteCeiling: snapshot.quote.totalMaxFrozenCost ?? null,
          currency: snapshot.quote.currency ?? null,
        },
      })
      issued.push({
        planSnapshotId: snapshot.id,
        operationId: snapshot.operationId,
        approvalGrantId: grant.id,
        requestId: grant.requestId,
      })
    }
    return issued
  })
}

export async function issueApprovalGrant(params: {
  userId: string
  planSnapshotId: string
  requestId: string
}): Promise<{ approvalGrantId: string; operationRequestId: string }> {
  const [issued] = await issueApprovalGrantGroup({
    userId: params.userId,
    requests: [{
      planSnapshotId: params.planSnapshotId,
      requestId: params.requestId,
    }],
  })
  if (!issued) throw new Error('APPROVAL_GRANT_ISSUANCE_EMPTY')
  return {
    approvalGrantId: issued.approvalGrantId,
    operationRequestId: issued.requestId,
  }
}

function assertSnapshotScope(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  operationId: string
  normalizedInput: unknown
  snapshot: NonNullable<Awaited<ReturnType<typeof loadOperationPlanSnapshot>>>
}): void {
  const expectedScopeKind = params.projectId === GLOBAL_ASSET_PROJECT_ID ? 'global_asset_hub' : 'project'
  const requestedEpisodeId = params.episodeId ?? null
  if (
    params.snapshot.userId !== params.userId ||
    params.snapshot.scopeKind !== expectedScopeKind ||
    params.snapshot.scopeId !== params.projectId ||
    params.snapshot.operationId !== params.operationId ||
    (requestedEpisodeId !== null && params.snapshot.episodeId !== requestedEpisodeId)
  ) {
    throw new ApiError('FORBIDDEN', {
      code: 'OPERATION_PLAN_SCOPE_MISMATCH',
      message: 'the approved plan does not belong to this user, scope, episode, or operation',
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

async function settleApprovalGrant(
  tx: Prisma.TransactionClient,
  params:
    | { readonly kind: 'revoke'; readonly grantId: string }
    | { readonly kind: 'consume'; readonly grantId: string; readonly executionId: string },
): Promise<void> {
  const settled = await tx.approvalGrant.updateMany({
    where: {
      id: params.grantId,
      version: 0,
      consumedAt: null,
      consumedExecutionId: null,
      revokedAt: null,
    },
    data: params.kind === 'consume'
      ? {
          consumedAt: new Date(),
          consumedExecutionId: params.executionId,
          version: { increment: 1 },
        }
      : {
          revokedAt: new Date(),
          version: { increment: 1 },
        },
  })
  if (settled.count !== 1) {
    throw new Error(`APPROVAL_GRANT_${params.kind === 'consume' ? 'CONSUME' : 'REVOKE'}_RACED:${params.grantId}`)
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
    params.grant.revokedAt
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
  const previewGrant = await prisma.approvalGrant.findUnique({
    where: { id: params.invocation.approvalGrantId },
  })
  if (!previewGrant) throw new ApiError('NOT_FOUND', { code: 'APPROVAL_GRANT_NOT_FOUND' })
  const previewSnapshot = await loadOperationPlanSnapshot(previewGrant.planSnapshotId)
  if (!previewSnapshot) throw new ApiError('NOT_FOUND', { code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND' })
  assertGrantMatchesSnapshot({
    grant: previewGrant,
    requestId: params.invocation.requestId,
    snapshot: previewSnapshot,
  })
  assertSnapshotScope({
    userId: params.ctx.userId,
    projectId: params.ctx.projectId,
    episodeId: params.ctx.context.episodeId ?? null,
    operationId: params.operation.id,
    normalizedInput: params.normalizedInput,
    snapshot: previewSnapshot,
  })
  const existingExecution = await prisma.operationExecution.findUnique({
    where: { approvalGrantId: previewGrant.id },
    select: { id: true },
  })
  const currentArtifacts = existingExecution
    ? null
    : await buildCurrentOperationPlanArtifactHashes({
        operation: params.operation,
        ctx: params.ctx,
        normalizedInput: params.normalizedInput,
      })
  const transactionResult = await prisma.$transaction(
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
        return { kind: 'output' as const, output: existing.output as Output }
      }
      if (grant.consumedAt || grant.consumedExecutionId) {
        throw new Error(`APPROVAL_GRANT_CONSUMED_WITHOUT_EXECUTION:${grant.id}`)
      }
      if (!currentArtifacts) {
        throw new Error(`OPERATION_PLAN_REVALIDATION_MISSING:${grant.id}`)
      }
      const changedArtifacts = changedOperationPlanArtifacts(snapshot, currentArtifacts)
      if (changedArtifacts.length > 0) {
        await settleApprovalGrant(tx, {
          kind: 'revoke',
          grantId: grant.id,
        })
        return { kind: 'plan_changed' as const, changedArtifacts }
      }

      const execution = await tx.operationExecution.create({
        data: {
          id: randomUUID(),
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
      await settleApprovalGrant(tx, {
        kind: 'consume',
        grantId: grant.id,
        executionId: execution.id,
      })
      const committedOutput = await commit(
        {
          ...params.ctx,
          context: {
            ...params.ctx.context,
            episodeId: snapshot.episodeId,
          },
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
      const waitTaskIds = Array.from(new Set([
        ...tasks.map((task) => task.id),
        ...(snapshot.plan.taskDependencies ?? []).map((dependency) => dependency.taskId),
      ])).sort()
      if (waitTaskIds.length > 0) {
        await params.ctx.taskBatchBinding?.bindInTransaction(tx, {
          operationId: params.operation.id,
          taskIds: waitTaskIds,
        })
      }
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
      return { kind: 'output' as const, output }
    },
    {
      maxWait: 10_000,
      timeout: APPROVED_OPERATION_TRANSACTION_TIMEOUT_MS,
    },
  )
  if (transactionResult.kind === 'plan_changed') {
    throw new ApiError('OPERATION_PLAN_CHANGED', {
      code: 'OPERATION_PLAN_CHANGED',
      changedArtifacts: transactionResult.changedArtifacts,
    })
  }
  params.ctx.taskBatchBinding?.markCommitted()
  for (const part of bufferedParts) {
    params.ctx.writer?.write(part)
  }
  return transactionResult.output
}
