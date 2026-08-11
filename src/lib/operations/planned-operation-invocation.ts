import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { lockAgentTurnEffectFence } from '@/lib/agent-turn/effect-fence'
import {
  isPlannedOperation,
  type ProjectAgentOperationContext,
  type ProjectAgentOperationDefinition,
} from './types'
import { loadOperationPlanSnapshot } from './operation-plan-snapshot'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import {
  buildCurrentOperationPlanArtifactHashes,
  changedOperationPlanArtifacts,
} from './operation-plan-revalidation'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'
import { schedulePersistedTask } from '@/lib/temporal/task-client'
import type { PersistedTaskReference, ScheduledTaskReceipt } from '@/lib/temporal/task/contracts'
import { isTaskType } from '@/lib/task/types'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'

const PLANNED_OPERATION_TRANSACTION_TIMEOUT_MS = 60_000
const PLANNED_OPERATION_MAX_TASKS = OPERATION_EXECUTION_MAX_TASKS

/** Immutable plan identity is sufficient authorization for confirmation-free plans. */
export interface PlannedOperationInvocation {
  planSnapshotId: string
  requestId: string
}

export interface OperationExecutionAuthorization {
  operationExecutionId: string
  transaction: Prisma.TransactionClient
}

export interface PlannedOperationExecutionTaskReceipt {
  reference: PersistedTaskReference
  schedule: ScheduledTaskReceipt
}

export interface PlannedOperationExecutionReceipt {
  operationExecutionId: string
  planSnapshotId: string
  operationRequestId: string
  outputHash: string
  tasks: readonly PlannedOperationExecutionTaskReceipt[]
}

export interface PlannedOperationInvocationResult<Output> {
  output: Output
  receipt: PlannedOperationExecutionReceipt
}

export class PlannedOperationExecutionReceiptError extends Error {
  constructor(readonly code: string, ...details: unknown[]) {
    super([code, ...details.map((detail) => String(detail))].join(':'))
    this.name = 'PlannedOperationExecutionReceiptError'
  }
}

function receiptError(code: string, ...details: unknown[]): never {
  throw new PlannedOperationExecutionReceiptError(code, ...details)
}

export function requireOperationExecutionTransaction(
  ctx: ProjectAgentOperationContext,
): Prisma.TransactionClient {
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

/** Separates immutable plan identity from the operation's business input. */
export function splitPlannedOperationInvocation(input: unknown): {
  invocation: PlannedOperationInvocation | null
  businessInput: unknown
} {
  if (!isRecord(input)) return { invocation: null, businessInput: input }
  if ('confirmed' in input || 'confirmedMaxCost' in input || 'approvalGrantId' in input) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'LEGACY_OPERATION_CONFIRMATION_UNSUPPORTED',
      message: 'execute the immutable plan snapshot directly',
    })
  }
  const planSnapshotId = input.planSnapshotId
  const requestId = input.operationRequestId
  const businessInput = Object.fromEntries(
    Object.entries(input).filter(
      ([key]) => key !== 'planSnapshotId' && key !== 'operationRequestId',
    ),
  )
  if (planSnapshotId === undefined && requestId === undefined) {
    return { invocation: null, businessInput }
  }
  if (
    typeof planSnapshotId !== 'string' ||
    !planSnapshotId.trim() ||
    typeof requestId !== 'string' ||
    !requestId.trim()
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_PLAN_INVOCATION_INVALID',
      message: 'planSnapshotId and operationRequestId are both required',
    })
  }
  return {
    invocation: {
      planSnapshotId: planSnapshotId.trim(),
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

function assertSnapshotScope(params: {
  userId: string
  projectId: string
  operationId: string
  normalizedInput: unknown
  invocation: PlannedOperationInvocation
  snapshot: NonNullable<Awaited<ReturnType<typeof loadOperationPlanSnapshot>>>
}): void {
  const expectedScopeKind =
    params.projectId === GLOBAL_ASSET_PROJECT_ID ? 'global_asset_hub' : 'project'
  if (
    params.snapshot.userId !== params.userId ||
    params.snapshot.scopeKind !== expectedScopeKind ||
    params.snapshot.scopeId !== params.projectId ||
    params.snapshot.operationId !== params.operationId ||
    (params.snapshot.apiRequestId !== null &&
      params.snapshot.apiRequestId !== params.invocation.requestId)
  ) {
    throw new ApiError('FORBIDDEN', {
      code: 'OPERATION_PLAN_SCOPE_MISMATCH',
      message: 'the immutable plan does not belong to this user, scope, operation, or request',
    })
  }
  if (hashCanonicalJson(params.normalizedInput) !== params.snapshot.inputHash) {
    throw new ApiError('CONFLICT', {
      code: 'OPERATION_PLAN_INPUT_CHANGED',
      message: 'the operation input differs from the immutable plan',
    })
  }
}

export async function loadPlannedOperationExecutionInput(params: {
  userId: string
  operationId: string
  invocation: PlannedOperationInvocation
}): Promise<unknown> {
  const snapshot = await loadOperationPlanSnapshot(params.invocation.planSnapshotId)
  if (!snapshot) throw new ApiError('NOT_FOUND', { code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND' })
  if (
    snapshot.userId !== params.userId ||
    snapshot.operationId !== params.operationId ||
    (snapshot.apiRequestId !== null && snapshot.apiRequestId !== params.invocation.requestId)
  ) {
    throw new ApiError('FORBIDDEN', { code: 'OPERATION_PLAN_SCOPE_MISMATCH' })
  }
  return snapshot.normalizedInput
}

export async function invokePlannedOperation<Input, Output>(params: {
  operation: ProjectAgentOperationDefinition<Input, Output>
  ctx: ProjectAgentOperationContext
  normalizedInput: Input
  invocation: PlannedOperationInvocation
}): Promise<Output> {
  if (!isPlannedOperation(params.operation)) {
    throw new ApiError('INVALID_PARAMS', { code: 'OPERATION_PLAN_NOT_APPLICABLE' })
  }
  const operation = params.operation as ProjectAgentOperationDefinition<Input, Output> & {
    planContractRevision: string
    commit: NonNullable<ProjectAgentOperationDefinition<Input, Output>['commit']>
  }
  type OperationWriter = NonNullable<ProjectAgentOperationContext['writer']>
  type BufferedOperationPart = Parameters<OperationWriter['write']>[0]
  const bufferedParts: BufferedOperationPart[] = []
  const bufferedWriter = { write(part: BufferedOperationPart) { bufferedParts.push(part) } } as OperationWriter
  const previewSnapshot = await loadOperationPlanSnapshot(params.invocation.planSnapshotId)
  if (!previewSnapshot) throw new ApiError('NOT_FOUND', { code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND' })
  assertSnapshotScope({
    userId: params.ctx.userId,
    projectId: params.ctx.projectId,
    operationId: params.operation.id,
    normalizedInput: params.normalizedInput,
    invocation: params.invocation,
    snapshot: previewSnapshot,
  })
  const existingExecution = await prisma.operationExecution.findFirst({
    where: { planSnapshotId: previewSnapshot.id, requestId: params.invocation.requestId },
    select: { id: true },
  })
  const executionContractChanged =
    !existingExecution &&
    previewSnapshot.executionContractRevision !== operation.planContractRevision
  const currentArtifacts = existingExecution || executionContractChanged
    ? null
    : await buildCurrentOperationPlanArtifactHashes({
        operation,
        ctx: params.ctx,
        normalizedInput: params.normalizedInput,
      })
  const transactionResult = await prisma.$transaction(async (tx) => {
    const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM projects WHERE id = ${params.ctx.projectId} FOR UPDATE
    `)
    if (projects.length !== 1) {
      throw new Error(`OPERATION_EXECUTION_PROJECT_NOT_FOUND:${params.ctx.projectId}`)
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM operation_plan_snapshots
      WHERE id = ${params.invocation.planSnapshotId} FOR UPDATE
    `)
    if (locked.length !== 1) {
      throw new ApiError('NOT_FOUND', { code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND' })
    }
    const snapshot = await loadOperationPlanSnapshot(params.invocation.planSnapshotId, tx)
    if (!snapshot) throw new ApiError('NOT_FOUND', { code: 'OPERATION_PLAN_SNAPSHOT_NOT_FOUND' })
    assertSnapshotScope({
      userId: params.ctx.userId,
      projectId: params.ctx.projectId,
      operationId: operation.id,
      normalizedInput: params.normalizedInput,
      invocation: params.invocation,
      snapshot,
    })
    const existing = await tx.operationExecution.findFirst({
      where: { planSnapshotId: snapshot.id, requestId: params.invocation.requestId },
    })
    if (existing) {
      if (existing.status !== 'completed' || existing.output === null) {
        throw new Error(`OPERATION_EXECUTION_DURABLE_INTERMEDIATE_STATE:${existing.id}:${existing.status}`)
      }
      return { kind: 'output' as const, output: existing.output as Output }
    }
    if (params.ctx.context.turnId) {
      await lockAgentTurnEffectFence(tx, {
        turnId: params.ctx.context.turnId,
        projectId: params.ctx.projectId,
        userId: params.ctx.userId,
      })
    }
    if (snapshot.executionContractRevision !== operation.planContractRevision) {
      return { kind: 'plan_changed' as const, changedArtifacts: ['executionContractRevision'] as const }
    }
    if (!currentArtifacts) throw new Error(`OPERATION_PLAN_REVALIDATION_MISSING:${snapshot.id}`)
    const changedArtifacts = changedOperationPlanArtifacts(snapshot, currentArtifacts)
    if (changedArtifacts.length > 0) return { kind: 'plan_changed' as const, changedArtifacts }
    const execution = await tx.operationExecution.create({
      data: {
        id: randomUUID(), executionKind: 'planned', userId: snapshot.userId,
        scopeKind: snapshot.scopeKind, scopeId: snapshot.scopeId, projectId: snapshot.projectId,
        operationId: snapshot.operationId, planSnapshotId: snapshot.id,
        requestId: params.invocation.requestId, status: 'committing',
      },
    })
    const committedOutput = await operation.commit(
      {
        ...params.ctx,
        writer: bufferedWriter,
        executionAuthorization: { operationExecutionId: execution.id, transaction: tx },
      },
      params.normalizedInput,
      snapshot.plan,
    )
    const parsedOutput = operation.outputSchema.safeParse(committedOutput)
    if (!parsedOutput.success) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'OPERATION_OUTPUT_INVALID',
        message: `operation output schema mismatch: ${operation.id}`,
        issues: parsedOutput.error.issues,
      })
    }
    const output = parsedOutput.data
    const tasks = await tx.task.findMany({
      where: { operationExecutionId: execution.id }, select: { id: true },
    })
    if (tasks.length !== snapshot.plan.tasks.length) {
      throw new Error(`OPERATION_PLAN_ATOMIC_COMMIT_INCOMPLETE:${execution.id}`)
    }
    const followUpTaskIds = Array.from(new Set([
      ...tasks.map((task) => task.id),
      ...(snapshot.plan.taskDependencies ?? []).map((dependency) => dependency.taskId),
    ])).sort()
    if (followUpTaskIds.length > 0) {
      await params.ctx.followUpBatchBinding?.bindInTransaction(tx, {
        operationId: operation.id, taskIds: followUpTaskIds,
      })
    }
    if (followUpTaskIds.length > 0 && !params.ctx.followUpBatchBinding?.isBound()) {
      throw new Error(`OPERATION_EXECUTION_FOLLOW_UP_BATCH_MISSING:${operation.id}`)
    }
    await tx.operationExecution.update({
      where: { id: execution.id },
      data: { status: 'completed', output: toJson(output), completedAt: new Date() },
    })
    return { kind: 'output' as const, output }
  }, { maxWait: 10_000, timeout: PLANNED_OPERATION_TRANSACTION_TIMEOUT_MS })
  if (transactionResult.kind === 'plan_changed') {
    throw new ApiError('OPERATION_PLAN_CHANGED', {
      code: 'OPERATION_PLAN_CHANGED', changedArtifacts: transactionResult.changedArtifacts,
    })
  }
  for (const part of bufferedParts) params.ctx.writer?.write(part)
  return transactionResult.output
}

async function loadPlannedOperationExecutionReceipt(params: {
  planSnapshotId: string
  operationRequestId: string
  userId: string
  projectId: string
  operationId: string
}): Promise<PlannedOperationExecutionReceipt> {
  const execution = await prisma.operationExecution.findFirst({
    where: { planSnapshotId: params.planSnapshotId, requestId: params.operationRequestId },
    include: { tasks: true },
  })
  if (
    !execution || execution.status !== 'completed' || execution.output === null ||
    execution.userId !== params.userId || execution.projectId !== params.projectId ||
    execution.operationId !== params.operationId || execution.planSnapshotId !== params.planSnapshotId ||
    execution.requestId !== params.operationRequestId || execution.tasks.length > PLANNED_OPERATION_MAX_TASKS
  ) receiptError('OPERATION_EXECUTION_RECEIPT_DIVERGED', params.planSnapshotId)
  const snapshot = await loadOperationPlanSnapshot(params.planSnapshotId)
  if (!snapshot || snapshot.userId !== params.userId || snapshot.projectId !== params.projectId ||
    snapshot.operationId !== params.operationId || snapshot.plan.tasks.length !== execution.tasks.length) {
    receiptError('OPERATION_EXECUTION_TASK_BATCH_DIVERGED', execution.id)
  }
  const byPlanTaskId = new Map(execution.tasks.map((task) => [task.operationPlanTaskId, task]))
  if (byPlanTaskId.has(null) || byPlanTaskId.size !== execution.tasks.length) {
    receiptError('OPERATION_EXECUTION_TASK_IDENTITY_DIVERGED', execution.id)
  }
  const references: PersistedTaskReference[] = snapshot.plan.tasks.map((planTask) => {
    const task = byPlanTaskId.get(planTask.id)
    if (!task || task.userId !== params.userId || task.projectId !== params.projectId ||
      task.operationId !== params.operationId || task.operationExecutionId !== execution.id ||
      task.operationRequestId !== params.operationRequestId || !isTaskType(task.type)) {
      return receiptError('OPERATION_EXECUTION_TASK_RECEIPT_DIVERGED', execution.id, planTask.id)
    }
    return { taskId: task.id, userId: task.userId, taskType: task.type }
  })
  return {
    operationExecutionId: execution.id,
    planSnapshotId: params.planSnapshotId,
    operationRequestId: params.operationRequestId,
    outputHash: hashCanonicalJson(execution.output),
    tasks: await Promise.all(references.map(async (reference) => ({
      reference, schedule: await schedulePersistedTask(reference),
    }))),
  }
}

export async function invokePlannedOperationWithReceipt<Input, Output>(params: {
  operation: ProjectAgentOperationDefinition<Input, Output>
  ctx: ProjectAgentOperationContext
  normalizedInput: Input
  invocation: PlannedOperationInvocation
}): Promise<PlannedOperationInvocationResult<Output>> {
  const output = await invokePlannedOperation(params)
  return {
    output,
    receipt: await loadPlannedOperationExecutionReceipt({
      planSnapshotId: params.invocation.planSnapshotId,
      operationRequestId: params.invocation.requestId,
      userId: params.ctx.userId,
      projectId: params.ctx.projectId,
      operationId: params.operation.id,
    }),
  }
}
