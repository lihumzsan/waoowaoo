import { createScopedLogger } from '@/lib/logging/core'
import { type CreateTaskInput, type TaskBillingInfo, type TaskType } from './types'
import {
  buildDefaultTaskBillingInfo,
  getBillingMode,
  isBillableTaskType,
} from '@/lib/billing'
import { ApiError } from '@/lib/api-errors'
import { getTaskFlowMeta } from '@/lib/llm-observe/stage-pipeline'
import type { Locale } from '@/i18n/routing'
import { buildTaskProgressGroupId, withTaskProgressGroupPayload } from './progress-group'
import type { BillingReceiptView } from '@/lib/billing/task-billing-view'
import { requiresBillableMediaApproval } from '@/lib/billing/media-approval-policy'
import type { Prisma } from '@prisma/client'

export function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export interface SubmitTaskResult {
  [key: string]: unknown
  success: boolean
  async: boolean
  taskId: string
  taskType: TaskType
  status: string
  deduped: boolean
  billingReceiptView?: BillingReceiptView | null
}

export function normalizeTaskPayload(type: TaskType, payload?: Record<string, unknown> | null) {
  const nextPayload = {
    ...(payload || {}),
  }
  const flowMeta = getTaskFlowMeta(type)
  const payloadMeta = toObject(nextPayload.meta)
  const flowId =
    typeof nextPayload.flowId === 'string' && nextPayload.flowId.trim()
      ? nextPayload.flowId.trim()
      : flowMeta.flowId
  const flowStageTitle =
    typeof nextPayload.flowStageTitle === 'string' && nextPayload.flowStageTitle.trim()
      ? nextPayload.flowStageTitle.trim()
      : flowMeta.flowStageTitle
  const flowStageIndex =
    typeof nextPayload.flowStageIndex === 'number' && Number.isFinite(nextPayload.flowStageIndex)
      ? Math.max(1, Math.floor(nextPayload.flowStageIndex))
      : flowMeta.flowStageIndex
  const flowStageTotal =
    typeof nextPayload.flowStageTotal === 'number' && Number.isFinite(nextPayload.flowStageTotal)
      ? Math.max(flowStageIndex, Math.floor(nextPayload.flowStageTotal))
      : Math.max(flowStageIndex, flowMeta.flowStageTotal)

  return {
    ...nextPayload,
    flowId,
    flowStageIndex,
    flowStageTotal,
    flowStageTitle,
    meta: {
      ...payloadMeta,
      flowId:
        typeof payloadMeta.flowId === 'string' && payloadMeta.flowId.trim()
          ? payloadMeta.flowId.trim()
          : flowId,
      flowStageIndex:
        typeof payloadMeta.flowStageIndex === 'number' && Number.isFinite(payloadMeta.flowStageIndex)
          ? Math.max(1, Math.floor(payloadMeta.flowStageIndex))
          : flowStageIndex,
      flowStageTotal:
        typeof payloadMeta.flowStageTotal === 'number' && Number.isFinite(payloadMeta.flowStageTotal)
          ? Math.max(1, Math.floor(payloadMeta.flowStageTotal))
          : flowStageTotal,
      flowStageTitle:
        typeof payloadMeta.flowStageTitle === 'string' && payloadMeta.flowStageTitle.trim()
          ? payloadMeta.flowStageTitle.trim()
          : flowStageTitle,
    },
  }
}

export type SubmitTaskParams = {
  userId: string
  locale: Locale
  projectId: string
  parentTaskId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  billingInfo?: TaskBillingInfo | null
  billingInfoSource?: 'auto' | 'planned'
  requestId?: string | null
  operationId?: string | null
  operationSource?: string | null
  operationExecutionId?: string | null
  operationRequestId?: string | null
  onTaskCreatedInTransaction?: (
    tx: Prisma.TransactionClient,
    task: { id: string },
  ) => Promise<void>
}

export async function prepareTaskSubmissionInput(params: SubmitTaskParams): Promise<{
  readonly input: CreateTaskInput
  readonly billingMode: Awaited<ReturnType<typeof getBillingMode>>
}> {
  const logger = createScopedLogger({
    module: 'task.submitter',
    action: 'task.submit',
    requestId: params.requestId || undefined,
    projectId: params.projectId,
    userId: params.userId,
  })

  const operationRequestId = params.operationRequestId || params.requestId || null
  const progressGroupId = buildTaskProgressGroupId({
    operationId: params.operationId || null,
    operationRequestId,
  })
  const normalizedPayloadBase = withTaskProgressGroupPayload(
    normalizeTaskPayload(params.type, params.payload || null),
    progressGroupId,
  )
  const normalizedPayloadMeta = toObject(normalizedPayloadBase.meta)
  const normalizedPayload = {
    ...normalizedPayloadBase,
    meta: {
      ...normalizedPayloadMeta,
      locale: params.locale,
      trace: {
        requestId: params.requestId || null,
      },
    },
  }
  const computedBillingInfo = isBillableTaskType(params.type)
    ? buildDefaultTaskBillingInfo(params.type, normalizedPayload)
    : null
  const resolvedBillingInfo = params.billingInfoSource === 'planned'
    ? params.billingInfo || computedBillingInfo || null
    : computedBillingInfo || params.billingInfo || null

  if (requiresBillableMediaApproval(resolvedBillingInfo)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BILLABLE_MEDIA_APPROVED_PLAN_SUBMITTER_REQUIRED',
      message: `billable media Task must be created by the approved operation plan authority: ${params.type}`,
    })
  }

  const billingMode = await getBillingMode()
  if (isBillableTaskType(params.type) && resolvedBillingInfo?.billable !== true) {
    if (billingMode === 'ENFORCE') {
      throw new ApiError('INVALID_PARAMS', {
        message: `missing server-generated billingInfo for billable task type: ${params.type}`,
      })
    }
    logger.warn({
      action: 'task.submit.billing_info_missing_non_enforce',
      message: `missing billingInfo ignored in ${billingMode} mode`,
      details: {
        type: params.type,
        billingMode,
      },
    })
  }

  const taskInput = {
    userId: params.userId,
    projectId: params.projectId,
    parentTaskId: params.parentTaskId || null,
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    payload: normalizedPayload,
    dedupeKey: params.dedupeKey || null,
    billingInfo: resolvedBillingInfo || null,
    operationId: params.operationId || null,
    operationSource: params.operationSource || null,
    approvalGrantId: null,
    operationExecutionId: params.operationExecutionId ?? null,
    operationPlanTaskId: null,
    operationRequestId,
  } satisfies CreateTaskInput
  return { input: taskInput, billingMode }
}
