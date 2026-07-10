import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import type { Locale } from '@/i18n/routing'
import type { TaskBillingInfo, TaskType } from './types'
import { canonicalJson, hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function assertTaskApprovalAuthorization(params: {
  approvalGrantId?: string | null
  operationExecutionId?: string | null
  operationPlanTaskId?: string | null
  userId: string
  projectId: string
  episodeId?: string | null
  operationId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  priority?: number
  locale: Locale
  billingInfo: TaskBillingInfo
}): Promise<void> {
  if (!params.approvalGrantId || !params.operationExecutionId || !params.operationPlanTaskId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BILLABLE_MEDIA_APPROVAL_GRANT_REQUIRED',
      message: `billable media Task must reference its approved plan: ${params.type}`,
    })
  }
  const execution = await prisma.operationExecution.findUnique({
    where: { id: params.operationExecutionId },
    include: { approvalGrant: true, planSnapshot: true },
  })
  if (
    !execution
    || execution.status !== 'running'
    || execution.approvalGrantId !== params.approvalGrantId
    || execution.userId !== params.userId
    || execution.scopeId !== params.projectId
    || execution.episodeId !== (params.episodeId ?? null)
    || execution.operationId !== params.operationId
  ) {
    throw new ApiError('FORBIDDEN', { code: 'TASK_APPROVAL_EXECUTION_SCOPE_MISMATCH' })
  }
  const grant = execution.approvalGrant
  if (
    grant.consumedExecutionId !== execution.id
    || !grant.consumedAt
    || grant.revokedAt
    || grant.expiresAt.getTime() <= Date.now()
    || grant.inputHash !== execution.planSnapshot.inputHash
    || grant.planHash !== execution.planSnapshot.planHash
    || grant.quoteHash !== execution.planSnapshot.quoteHash
    || hashCanonicalJson(execution.planSnapshot.planSnapshot) !== grant.planHash
  ) {
    throw new ApiError('CONFLICT', { code: 'TASK_APPROVAL_GRANT_NOT_USABLE' })
  }
  if (!isRecord(execution.planSnapshot.planSnapshot)) {
    throw new Error(`OPERATION_PLAN_SNAPSHOT_INVALID:${execution.planSnapshotId}`)
  }
  const tasks = execution.planSnapshot.planSnapshot.tasks
  if (!Array.isArray(tasks)) throw new Error(`OPERATION_PLAN_TASKS_INVALID:${execution.planSnapshotId}`)
  const planned = tasks.find((value) => isRecord(value) && value.id === params.operationPlanTaskId)
  if (!isRecord(planned) || !isRecord(planned.target)) {
    throw new ApiError('FORBIDDEN', { code: 'TASK_NOT_IN_APPROVED_OPERATION_PLAN' })
  }
  const actual = {
    id: params.operationPlanTaskId,
    taskType: params.type,
    target: { targetType: params.targetType, targetId: params.targetId },
    payload: params.payload ?? {},
    billingInfo: params.billingInfo,
    locale: params.locale,
    episodeId: params.episodeId ?? null,
    dedupeKey: params.dedupeKey ?? null,
    priority: params.priority ?? 0,
  }
  const expected = {
    ...planned,
    episodeId: planned.episodeId ?? null,
    dedupeKey: planned.dedupeKey ?? null,
    priority: typeof planned.priority === 'number' ? planned.priority : 0,
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new ApiError('CONFLICT', {
      code: 'TASK_DIFFERS_FROM_APPROVED_OPERATION_PLAN',
      operationPlanTaskId: params.operationPlanTaskId,
    })
  }
}
