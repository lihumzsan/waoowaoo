import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { createScopedLogger } from '@/lib/logging/core'
import { getBillingMode } from '@/lib/billing'
import { buildBillingReceiptView } from '@/lib/billing/task-billing-view'
import { loadOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import type { PlannedTask } from '@/lib/operations/plan-contract'
import { buildTaskProgressGroupId, withTaskProgressGroupPayload } from './progress-group'
import { normalizeTaskPayload, toObject, type SubmitTaskResult } from './submitter'
import { isTaskType, type CreateTaskInput, type TaskBillingInfo } from './types'
import { persistSubmittedTaskBatchInTransaction } from './transactional-create'

const logger = createScopedLogger({ module: 'task.submitter' })

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
    type: params.task.taskType,
    targetType: params.task.target.targetType,
    targetId: params.task.target.targetId,
    payload,
    dedupeKey: params.task.dedupeKey ?? null,
    billingInfo: params.task.billingInfo,
    operationId: params.operationId,
    operationSource: params.operationSource,
    approvalGrantId: params.approvalGrantId,
    operationExecutionId: params.operationExecutionId,
    operationPlanTaskId: params.task.id,
    operationRequestId: params.operationRequestId,
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
  if (
    !execution
    || execution.status !== 'committing'
    || execution.approvalGrantId !== params.approvalGrantId
    || execution.planSnapshotId === null
  ) {
    throw new Error(`OPERATION_EXECUTION_AUTHORIZATION_INVALID:${params.operationExecutionId}`)
  }
  const snapshot = await loadOperationPlanSnapshot(execution.planSnapshotId, tx)
  if (!snapshot) throw new Error(`OPERATION_PLAN_SNAPSHOT_NOT_FOUND:${execution.planSnapshotId}`)
  const planTaskIds = snapshot.plan.tasks.map((task) => task.id)
  if (new Set(planTaskIds).size !== planTaskIds.length) {
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
  if (
    !grant
    || grant.revokedAt
    || !grant.consumedAt
    || grant.consumedExecutionId !== params.operationExecutionId
    || grant.version !== 1
  ) {
    throw new Error(`APPROVAL_GRANT_NOT_USABLE:${params.approvalGrantId}`)
  }

  if (planned.length === 0) return new Map()

  const persisted = await persistSubmittedTaskBatchInTransaction({
    tx,
    inputs: planned,
    billingMode,
  })
  logger.info({
    action: 'task.submit.persisted',
    message: 'approved operation plan tasks persisted for Temporal scheduling',
    operationId: execution.operationId,
    projectId: snapshot.plan.projectId,
    userId: execution.userId,
    requestId: execution.requestId,
    details: {
      operationExecutionId: params.operationExecutionId,
      approvalGrantId: params.approvalGrantId,
      count: persisted.length,
      dedupedCount: persisted.filter(({ deduped }) => deduped).length,
      taskIds: persisted.map(({ task }) => task.id),
      taskTypes: persisted.map(({ task }) => task.type),
    },
  })
  return await buildSubmitTaskResults(persisted.map(({ task, deduped }) => ({
      id: task.id,
      taskType: task.type,
      operationPlanTaskId: task.operationPlanTaskId,
      status: task.status,
      billingInfo: task.billingInfo,
      deduped,
  })))
}

async function buildSubmitTaskResults(
  stored: Array<{
    id: string
    taskType: string
    operationPlanTaskId: string | null
    status: string
    billingInfo: Prisma.JsonValue | null
    deduped: boolean
  }>,
): Promise<Map<string, SubmitTaskResult>> {
  const result = new Map<string, SubmitTaskResult>()
  for (const task of stored) {
    if (!task.operationPlanTaskId) throw new Error(`OPERATION_PLAN_TASK_ID_MISSING:${task.id}`)
    if (!isTaskType(task.taskType)) throw new Error(`TASK_TYPE_UNSUPPORTED:${task.taskType}`)
    const billingInfo = task.billingInfo as TaskBillingInfo | null
    result.set(task.operationPlanTaskId, {
      success: true,
      async: true,
      taskId: task.id,
      taskType: task.taskType,
      status: task.status,
      deduped: task.deduped,
      billingReceiptView: await buildBillingReceiptView(billingInfo),
    })
  }
  return result
}
