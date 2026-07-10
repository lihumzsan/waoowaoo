import type { NextRequest } from 'next/server'
import { getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { type TaskBillingInfo, type TaskType } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import type { Locale } from '@/i18n/routing'
import type { OperationExecutionAuthorization } from './planned-operation-invocation'
import type { Prisma } from '@prisma/client'

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function submitOperationTask(params: {
  request: NextRequest
  userId: string
  projectId: string
  parentTaskId?: string | null
  episodeId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  operationId: string
  source: string
  executionAuthorization?: OperationExecutionAuthorization | null
  operationPlanTaskId?: string | null
  payload: Record<string, unknown>
  dedupeKey?: string | null
  batchKey?: string | null
  priority?: number
  locale?: Locale
  billingInfo?: TaskBillingInfo | null
  billingInfoSource?: 'auto' | 'planned'
  decoratePayload?: boolean
  onTaskCreatedInTransaction?: (
    tx: Prisma.TransactionClient,
    task: { id: string },
  ) => Promise<void>
}) {
  const locale = params.locale ?? resolveRequiredTaskLocale(params.request, params.payload)
  const billingInfo = params.billingInfo !== undefined
    ? params.billingInfo
    : isBillableTaskType(params.type)
      ? buildDefaultTaskBillingInfo(params.type, params.payload)
      : null
  const payload = params.decoratePayload === false
    ? params.payload
    : {
        ...params.payload,
        sync: 1,
        meta: {
          ...(typeof params.payload.meta === 'object' && params.payload.meta && !Array.isArray(params.payload.meta) ? params.payload.meta as Record<string, unknown> : {}),
          locale,
        },
      }
  return await submitTask({
    userId: params.userId,
    locale,
    requestId: getRequestId(params.request),
    projectId: params.projectId,
    parentTaskId: params.parentTaskId || null,
    episodeId: params.episodeId || null,
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    payload,
    dedupeKey: params.dedupeKey || null,
    batchKey: params.batchKey || null,
    priority: params.priority ?? 0,
    billingInfo,
    billingInfoSource: params.billingInfoSource,
    operationId: params.operationId,
    operationSource: params.source,
    approvalGrantId: params.executionAuthorization?.approvalGrantId ?? null,
    operationExecutionId: params.executionAuthorization?.operationExecutionId ?? null,
    operationPlanTaskId: params.operationPlanTaskId ?? null,
    operationRequestId: getRequestId(params.request),
    onTaskCreatedInTransaction: params.onTaskCreatedInTransaction,
  })
}
