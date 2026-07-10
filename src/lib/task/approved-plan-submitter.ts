import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { getBillingMode, prepareTaskBillingInTransaction } from '@/lib/billing'
import { buildBillingReceiptView } from '@/lib/billing/task-billing-view'
import { createOutboxCommandInTransaction } from '@/lib/outbox/repository'
import { OUTBOX_COMMAND_KIND } from '@/lib/outbox/types'
import { loadOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import type { PlannedTask } from '@/lib/operations/planning'
import { buildTaskLifecycleEventPayload } from './publisher'
import { createTaskExecutionFingerprint } from './execution-identity'
import { buildTaskProgressGroupId, withTaskProgressGroupPayload } from './progress-group'
import { normalizeTaskPayload, toObject, type SubmitTaskResult } from './submitter'
import { TASK_EVENT_TYPE, TASK_STATUS, type CreateTaskInput, type TaskBillingInfo } from './types'

function toJson(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function taskIdForPlanItem(operationExecutionId: string, operationPlanTaskId: string): string {
  return `opt_${createHash('sha256').update(`${operationExecutionId}\u0000${operationPlanTaskId}`).digest('hex').slice(0, 40)}`
}

function preparePlannedTask(params: {
  task: PlannedTask
  userId: string
  projectId: string
  operationId: string
  operationSource: string
  approvalGrantId: string
  operationExecutionId: string
  operationRequestId: string
}): CreateTaskInput & {
  id: string
  payload: Record<string, unknown>
  billingInfo: TaskBillingInfo
} {
  const progressGroupId = buildTaskProgressGroupId({
    operationId: params.operationId,
    operationRequestId: params.operationRequestId,
  })
  const normalizedPayloadBase = withTaskProgressGroupPayload(
    normalizeTaskPayload(params.task.taskType, params.task.payload),
    progressGroupId,
  )
  const normalizedPayloadMeta = toObject(normalizedPayloadBase.meta)
  const payload = {
    ...normalizedPayloadBase,
    meta: {
      ...normalizedPayloadMeta,
      locale: params.task.locale,
      trace: { requestId: params.operationRequestId },
    },
  }
  return {
    id: taskIdForPlanItem(params.operationExecutionId, params.task.id),
    userId: params.userId,
    projectId: params.projectId,
    parentTaskId: null,
    episodeId: params.task.episodeId ?? null,
    type: params.task.taskType,
    targetType: params.task.target.targetType,
    targetId: params.task.target.targetId,
    payload,
    dedupeKey: params.task.dedupeKey ?? null,
    batchKey: null,
    priority: params.task.priority ?? 0,
    billingInfo: params.task.billingInfo,
    operationId: params.operationId,
    operationSource: params.operationSource,
    approvalGrantId: params.approvalGrantId,
    operationExecutionId: params.operationExecutionId,
    operationPlanTaskId: params.task.id,
    operationRequestId: params.operationRequestId,
  }
}

function assertExistingBatch(params: {
  planned: Array<ReturnType<typeof preparePlannedTask>>
  existing: Array<{
    operationPlanTaskId: string | null
    executionFingerprint: string | null
  }>
  executionId: string
}): void {
  if (params.existing.length !== params.planned.length) {
    throw new Error(`OPERATION_PLAN_TASK_BATCH_PARTIAL:${params.executionId}:${params.existing.length}:${params.planned.length}`)
  }
  const existingByPlanTask = new Map(params.existing.map((task) => [task.operationPlanTaskId, task]))
  for (const planned of params.planned) {
    const existing = existingByPlanTask.get(planned.operationPlanTaskId ?? null)
    const fingerprint = createTaskExecutionFingerprint(planned)
    if (!existing || existing.executionFingerprint !== fingerprint) {
      throw new Error(`OPERATION_PLAN_TASK_BATCH_CONFLICT:${params.executionId}:${String(planned.operationPlanTaskId)}`)
    }
  }
}

export async function submitApprovedOperationPlanTasks(params: {
  approvalGrantId: string
  operationExecutionId: string
  transaction: Prisma.TransactionClient
  operationSource: string
}): Promise<Map<string, SubmitTaskResult>> {
  const tx = params.transaction
  const execution = await tx.operationExecution.findUnique({
    where: { id: params.operationExecutionId },
  })
  if (!execution || execution.approvalGrantId !== params.approvalGrantId) {
    throw new Error(`OPERATION_EXECUTION_AUTHORIZATION_INVALID:${params.operationExecutionId}`)
  }
  const snapshot = await loadOperationPlanSnapshot(execution.planSnapshotId, tx)
  if (!snapshot) throw new Error(`OPERATION_PLAN_SNAPSHOT_NOT_FOUND:${execution.planSnapshotId}`)
  const planTaskIds = snapshot.plan.tasks.map((task) => task.id)
  if (planTaskIds.length === 0 || new Set(planTaskIds).size !== planTaskIds.length) {
    throw new Error(`OPERATION_PLAN_TASK_IDENTITIES_INVALID:${snapshot.id}`)
  }
  const planned = snapshot.plan.tasks.map((task) =>
    preparePlannedTask({
      task,
      userId: execution.userId,
      projectId: snapshot.plan.projectId,
      operationId: execution.operationId,
      operationSource: params.operationSource,
      approvalGrantId: params.approvalGrantId,
      operationExecutionId: params.operationExecutionId,
      operationRequestId: execution.requestId,
    }),
  )
  const billingMode = await getBillingMode()

  const grant = await tx.approvalGrant.findUnique({
    where: { id: params.approvalGrantId },
  })
  if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) {
    throw new Error(`APPROVAL_GRANT_NOT_USABLE:${params.approvalGrantId}`)
  }

  const existing = await tx.task.findMany({
    where: { operationExecutionId: params.operationExecutionId },
    select: {
      id: true,
      operationPlanTaskId: true,
      executionFingerprint: true,
      status: true,
      billingInfo: true,
    },
    orderBy: { operationPlanTaskId: 'asc' },
  })
  if (existing.length > 0) {
    assertExistingBatch({
      planned,
      existing,
      executionId: params.operationExecutionId,
    })
    if (!grant.consumedAt || grant.consumedExecutionId !== params.operationExecutionId) {
      throw new Error(`OPERATION_PLAN_TASK_BATCH_GRANT_MISMATCH:${params.operationExecutionId}`)
    }
    return buildSubmitTaskResults(existing, execution.status === 'completed')
  }

  const consumed = await tx.approvalGrant.updateMany({
    where: {
      id: params.approvalGrantId,
      version: 0,
      consumedAt: null,
      consumedExecutionId: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      consumedAt: new Date(),
      consumedExecutionId: params.operationExecutionId,
      version: { increment: 1 },
    },
  })
  if (consumed.count !== 1) {
    throw new Error(`APPROVAL_GRANT_CONSUME_RACED:${params.approvalGrantId}`)
  }

  const created = []
  for (const input of planned) {
    const task = await tx.task.create({
      data: {
        id: input.id,
        userId: input.userId,
        projectId: input.projectId,
        parentTaskId: input.parentTaskId,
        episodeId: input.episodeId,
        type: input.type,
        targetType: input.targetType,
        targetId: input.targetId,
        status: TASK_STATUS.QUEUED,
        progress: 0,
        attempt: 0,
        priority: input.priority,
        dedupeKey: input.dedupeKey,
        batchKey: input.batchKey,
        operationId: input.operationId,
        operationSource: input.operationSource,
        approvalGrantId: input.approvalGrantId,
        operationExecutionId: input.operationExecutionId,
        operationPlanTaskId: input.operationPlanTaskId,
        operationRequestId: input.operationRequestId,
        payload: toJson(input.payload),
        executionFingerprint: createTaskExecutionFingerprint(input),
        billingInfo: toJson(input.billingInfo),
        queuedAt: new Date(),
      },
    })
    const preparedBilling = (await prepareTaskBillingInTransaction(
      tx,
      {
        id: task.id,
        userId: task.userId,
        projectId: task.projectId,
        episodeId: task.episodeId,
        billingInfo: input.billingInfo,
      },
      billingMode,
    )) as TaskBillingInfo | null
    const updated = await tx.task.update({
      where: { id: task.id },
      data: { billingInfo: toJson(preparedBilling) },
      select: {
        id: true,
        operationPlanTaskId: true,
        executionFingerprint: true,
        status: true,
        billingInfo: true,
      },
    })
    const event = await tx.taskEvent.create({
      data: {
        taskId: task.id,
        projectId: task.projectId,
        userId: task.userId,
        eventType: TASK_EVENT_TYPE.CREATED,
        idempotencyKey: `task-created:${task.id}`,
        payload: toJson(
          buildTaskLifecycleEventPayload({
            taskId: task.id,
            projectId: task.projectId,
            lifecycleType: TASK_EVENT_TYPE.CREATED,
            taskType: task.type,
            targetType: task.targetType,
            targetId: task.targetId,
            episodeId: task.episodeId,
            coveragePayload: input.payload,
            payload: {
              ...input.payload,
              billing: preparedBilling,
              trace: { requestId: execution.requestId },
            },
          }),
        ),
      },
    })
    await createOutboxCommandInTransaction(tx, {
      idempotencyKey: `task-lifecycle-broadcast:${event.id}`,
      aggregateType: 'task',
      aggregateId: task.id,
      payload: {
        kind: OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST,
        version: 1,
        eventId: event.id,
        taskId: task.id,
      },
    })
    await createOutboxCommandInTransaction(tx, {
      idempotencyKey: `task-enqueue:${task.id}`,
      aggregateType: 'task',
      aggregateId: task.id,
      payload: {
        kind: OUTBOX_COMMAND_KIND.TASK_ENQUEUE,
        version: 1,
        taskId: task.id,
        operationExecutionId: params.operationExecutionId,
      },
    })
    created.push(updated)
  }
  return buildSubmitTaskResults(created, false)
}

async function buildSubmitTaskResults(
  stored: Array<{
    id: string
    operationPlanTaskId: string | null
    executionFingerprint: string | null
    status: string
    billingInfo: Prisma.JsonValue | null
  }>,
  deduped: boolean,
): Promise<Map<string, SubmitTaskResult>> {
  const result = new Map<string, SubmitTaskResult>()
  for (const task of stored) {
    if (!task.operationPlanTaskId) throw new Error(`OPERATION_PLAN_TASK_ID_MISSING:${task.id}`)
    const billingInfo = task.billingInfo as TaskBillingInfo | null
    result.set(task.operationPlanTaskId, {
      success: true,
      async: true,
      taskId: task.id,
      runId: null,
      status: task.status,
      deduped,
      billingReceiptView: await buildBillingReceiptView(billingInfo),
    })
  }
  return result
}
