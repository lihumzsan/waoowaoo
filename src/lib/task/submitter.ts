import { createScopedLogger } from '@/lib/logging/core'
import { addTaskJob } from './queues'
import { publishTaskEvent } from './publisher'
import {
  createTask,
  markTaskEnqueueFailed,
  markTaskEnqueued,
} from './service'
import { TASK_EVENT_TYPE, TASK_STATUS, type TaskBillingInfo, type TaskType } from './types'
import {
  buildDefaultTaskBillingInfo,
  authorizeTaskBilling,
  getBillingMode,
  InsufficientBalanceError,
  isBillableTaskType,
} from '@/lib/billing'
import { ApiError } from '@/lib/api-errors'
import { getTaskFlowMeta } from '@/lib/llm-observe/stage-pipeline'
import type { Locale } from '@/i18n/routing'
import { buildTaskProgressGroupId, withTaskProgressGroupPayload } from './progress-group'
import { buildBillingReceiptView, type BillingReceiptView } from '@/lib/billing/task-billing-view'
import { requiresBillableMediaApproval } from '@/lib/billing/media-approval-policy'
import { buildTaskJobEnvelope } from './job-envelope'
import { commitTaskTerminal } from './terminal'
import { observeTaskJob } from './reconcile'

export function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function isActiveTaskStatus(status: string | null | undefined) {
  return status === TASK_STATUS.QUEUED || status === TASK_STATUS.PROCESSING
}

export function shouldAttachNewTaskToReusableRun(reusableRunTaskStatus: string | null | undefined) {
  return !isActiveTaskStatus(reusableRunTaskStatus)
}

export interface SubmitTaskResult {
  [key: string]: unknown
  success: boolean
  async: boolean
  taskId: string
  runId: string | null
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

export async function submitTask(params: {
  userId: string
  locale: Locale
  projectId: string
  parentTaskId?: string | null
  episodeId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  batchKey?: string | null
  priority?: number
  billingInfo?: TaskBillingInfo | null
  billingInfoSource?: 'auto' | 'planned'
  requestId?: string | null
  operationId?: string | null
  operationSource?: string | null
  operationConfirmed?: boolean | null
  operationRequestId?: string | null
}): Promise<SubmitTaskResult> {
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

  if (requiresBillableMediaApproval(resolvedBillingInfo) && params.operationConfirmed !== true) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BILLABLE_MEDIA_APPROVAL_REQUIRED',
      message: `billable media approval is required before submitting task: ${params.type}`,
      taskType: params.type,
      apiType: resolvedBillingInfo.apiType,
      operationId: params.operationId || null,
    })
  }

  const { task, deduped } = await createTask({
    userId: params.userId,
    projectId: params.projectId,
    parentTaskId: params.parentTaskId || null,
    episodeId: params.episodeId || null,
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    payload: normalizedPayload,
    dedupeKey: params.dedupeKey || null,
    batchKey: params.batchKey || null,
    priority: params.priority,
    billingInfo: resolvedBillingInfo || null,
    operationId: params.operationId || null,
    operationSource: params.operationSource || null,
    operationConfirmed: params.operationConfirmed ?? null,
    operationRequestId,
  })
  const runId: string | null = null

  let preparedBillingInfo = (task.billingInfo || resolvedBillingInfo || null) as TaskBillingInfo | null
  if (!deduped && isBillableTaskType(params.type) && preparedBillingInfo?.billable !== true) {
    const billingMode = await getBillingMode()
    if (billingMode === 'ENFORCE') {
      await commitTaskTerminal({
        kind: 'failed',
        taskId: task.id,
        fence: { kind: 'active' },
        source: 'validation',
        errorCode: 'INVALID_PARAMS',
        errorMessage: `missing server-generated billingInfo for billable task type: ${params.type}`,
        eventPayload: { stage: 'billing_validation_failed' },
      })
      throw new ApiError('INVALID_PARAMS', {
        message: `missing server-generated billingInfo for billable task type: ${params.type}`,
      })
    }
    logger.warn({
      action: 'task.submit.billing_info_missing_non_enforce',
      message: `missing billingInfo ignored in ${billingMode} mode`,
      taskId: task.id,
      details: {
        type: params.type,
        billingMode,
      },
    })
  }

  if (!deduped && preparedBillingInfo) {
    try {
      preparedBillingInfo = await authorizeTaskBilling(task.id)
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        await commitTaskTerminal({
          kind: 'failed',
          taskId: task.id,
          fence: { kind: 'active' },
          source: 'validation',
          errorCode: 'INSUFFICIENT_BALANCE',
          errorMessage: error.message,
          eventPayload: { stage: 'billing_prepare_failed' },
        })
        throw new ApiError('INSUFFICIENT_BALANCE', {
          message: error.message,
          required: error.required,
          available: error.available,
        })
      }
      await commitTaskTerminal({
        kind: 'failed',
        taskId: task.id,
        fence: { kind: 'active' },
        source: 'validation',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: error instanceof Error ? error.message : String(error),
        eventPayload: { stage: 'billing_prepare_failed' },
      })
      throw error
    }
  }

  if (!deduped) {
    await publishTaskEvent({
      taskId: task.id,
      projectId: params.projectId,
      userId: params.userId,
      type: TASK_EVENT_TYPE.CREATED,
      taskType: params.type,
      targetType: params.targetType,
      targetId: params.targetId,
      episodeId: params.episodeId || null,
      payload: {
        ...normalizedPayload,
        parentTaskId: params.parentTaskId || null,
        billing: preparedBillingInfo || null,
        trace: {
          requestId: params.requestId || null,
        },
      },
    })
  }
  logger.info({
    action: 'task.submit.created',
    message: 'task created',
    taskId: task.id,
    details: {
      type: params.type,
      targetType: params.targetType,
      targetId: params.targetId,
    },
  })

  if (!deduped) {
    try {
      const envelope = buildTaskJobEnvelope({
        id: task.id,
        parentTaskId: params.parentTaskId || null,
        type: params.type,
        projectId: params.projectId,
        episodeId: params.episodeId || null,
        targetType: params.targetType,
        targetId: params.targetId,
        payload: normalizedPayload,
        batchKey: params.batchKey || null,
        billingInfo: preparedBillingInfo || null,
        userId: params.userId,
        operationId: params.operationId || null,
        operationSource: params.operationSource || null,
        operationConfirmed: params.operationConfirmed ?? null,
        operationRequestId,
        priority: task.priority,
      })
      await addTaskJob(envelope.data, {
        priority: envelope.priority,
      })
      await markTaskEnqueued(task.id)
      logger.info({
        action: 'task.submit.enqueued',
        message: 'task enqueued',
        taskId: task.id,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const failedMessage = message || 'queue add failed'
      const observation = await observeTaskJob(task.id)
      if (observation === 'alive' || typeof observation === 'object') {
        await markTaskEnqueued(task.id)
        logger.warn({
          action: 'task.submit.enqueue_response_lost',
          message: 'queue add threw after BullMQ accepted the deterministic task job',
          taskId: task.id,
          details: { observation },
        })
      } else if (observation === 'unavailable') {
        await markTaskEnqueueFailed(task.id, failedMessage)
        logger.error({
          action: 'task.submit.enqueue_unavailable',
          message: failedMessage,
          taskId: task.id,
          errorCode: 'EXTERNAL_ERROR',
          retryable: true,
        })
        throw new ApiError('EXTERNAL_ERROR', {
          message: failedMessage,
          taskId: task.id,
        })
      } else {
        await markTaskEnqueueFailed(task.id, failedMessage)
      await commitTaskTerminal({
        kind: 'failed',
        taskId: task.id,
        fence: { kind: 'active' },
        source: 'enqueue',
        errorCode: 'ENQUEUE_FAILED',
        errorMessage: failedMessage,
        eventPayload: {
          stage: 'enqueue_failed',
          stageLabel: 'progress.stage.enqueueFailed',
          message: failedMessage,
          errorCode: 'ENQUEUE_FAILED',
        },
      })
      logger.error({
        action: 'task.submit.enqueue_failed',
        message: failedMessage,
        taskId: task.id,
        errorCode: 'EXTERNAL_ERROR',
        retryable: false,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
              : {
                message: String(error),
              },
      })
      throw new ApiError('EXTERNAL_ERROR', {
        message: failedMessage,
        taskId: task.id,
      })
      }
    }
  }

  return {
    success: true,
    async: true,
    taskId: task.id,
    runId,
    status: task.status,
    deduped,
    billingReceiptView: await buildBillingReceiptView(preparedBillingInfo),
  }
}
