import { type CreateTaskInput, type TaskType } from './types'
import { getTaskFlowMeta } from '@/lib/llm-observe/stage-pipeline'
import type { Locale } from '@/i18n/routing'
import { buildTaskProgressGroupId, withTaskProgressGroupPayload } from './progress-group'
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

export async function prepareTaskSubmissionInput(params: SubmitTaskParams): Promise<CreateTaskInput> {
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
  const taskInput = {
    userId: params.userId,
    projectId: params.projectId,
    parentTaskId: params.parentTaskId || null,
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    payload: normalizedPayload,
    dedupeKey: params.dedupeKey || null,
    operationId: params.operationId || null,
    operationSource: params.operationSource || null,
    approvalGrantId: null,
    operationExecutionId: params.operationExecutionId ?? null,
    operationPlanTaskId: null,
    operationRequestId,
  } satisfies CreateTaskInput
  return taskInput
}
