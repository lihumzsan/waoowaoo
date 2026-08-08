import type { NextRequest } from 'next/server'
import { getRequestId } from '@/lib/api-errors'
import { ApiError } from '@/lib/api-errors'
import {
  prepareTaskSubmissionInput,
  type SubmitTaskResult,
} from '@/lib/task/submitter'
import {
  isTaskType,
  type TaskBillingInfo,
  type TaskType,
} from '@/lib/task/types'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing'
import type { Locale } from '@/i18n/routing'
import type { Prisma } from '@prisma/client'
import type { ProjectAgentFollowUpBatchBinding } from '@/lib/operations/types'
import { persistSubmittedTaskBatchInTransaction } from '@/lib/task/transactional-create'
import { buildBillingReceiptView } from '@/lib/billing/task-billing-view'
import { InsufficientBalanceError } from '@/lib/billing'

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export interface OperationTaskSubmissionParams {
  request: NextRequest | null
  requestId?: string | null
  userId: string
  projectId: string
  parentTaskId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  operationId: string
  source: string
  operationExecutionId?: string | null
  operationExecutionTransaction?: Prisma.TransactionClient | null
  followUpBatchBinding?: ProjectAgentFollowUpBatchBinding | null
  payload: Record<string, unknown>
  dedupeKey?: string | null
  locale: Locale
  billingInfo?: TaskBillingInfo | null
  billingInfoSource?: 'auto' | 'planned'
  decoratePayload?: boolean
  onTaskCreatedInTransaction?: (
    tx: Prisma.TransactionClient,
    task: { id: string },
  ) => Promise<void>
}

async function prepareOperationTaskSubmission(
  params: OperationTaskSubmissionParams,
) {
  const explicitRequestId = params.requestId?.trim() || null
  const requestId =
    explicitRequestId ?? (params.request ? getRequestId(params.request) : null)
  if (!requestId) {
    throw new Error('OPERATION_TASK_REQUEST_ID_REQUIRED')
  }
  const locale = params.locale
  const billingInfo =
    params.billingInfo !== undefined
      ? params.billingInfo
      : isBillableTaskType(params.type)
        ? buildDefaultTaskBillingInfo(params.type, params.payload)
        : null
  const payload =
    params.decoratePayload === false
      ? params.payload
      : {
          ...params.payload,
          sync: 1,
          meta: {
            ...(typeof params.payload.meta === 'object' &&
            params.payload.meta &&
            !Array.isArray(params.payload.meta)
              ? (params.payload.meta as Record<string, unknown>)
              : {}),
            locale,
          },
        }
  const prepared = await prepareTaskSubmissionInput({
    userId: params.userId,
    locale,
    requestId,
    projectId: params.projectId,
    parentTaskId: params.parentTaskId || null,
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    payload,
    dedupeKey: params.dedupeKey || null,
    billingInfo,
    billingInfoSource: params.billingInfoSource,
    operationId: params.operationId,
    operationSource: params.source,
    operationExecutionId: params.operationExecutionId,
    operationRequestId: requestId,
  })
  return {
    prepared,
    operationExecutionTransaction: params.operationExecutionTransaction ?? null,
    followUpBatchBinding: params.followUpBatchBinding ?? null,
    onTaskCreatedInTransaction: params.onTaskCreatedInTransaction,
  }
}

export async function submitOperationTaskBatch(
  submissions: readonly OperationTaskSubmissionParams[],
): Promise<readonly SubmitTaskResult[]> {
  if (submissions.length === 0) throw new Error('OPERATION_TASK_BATCH_EMPTY')
  const prepared = await Promise.all(
    submissions.map(prepareOperationTaskSubmission),
  )
  const billingMode = prepared[0]?.prepared.billingMode
  if (
    !billingMode ||
    prepared.some((item) => item.prepared.billingMode !== billingMode)
  ) {
    throw new Error('OPERATION_TASK_BATCH_BILLING_MODE_MISMATCH')
  }
  const operationId = prepared[0]?.prepared.input.operationId?.trim() ?? ''
  if (
    !operationId ||
    prepared.some((item) => item.prepared.input.operationId !== operationId)
  ) {
    throw new Error('OPERATION_TASK_BATCH_OPERATION_ID_MISMATCH')
  }
  const operationExecutionTransaction =
    prepared[0]?.operationExecutionTransaction ?? null
  if (
    prepared.some(
      (item) =>
        item.operationExecutionTransaction !== operationExecutionTransaction,
    )
  ) {
    throw new Error('OPERATION_TASK_BATCH_TRANSACTION_MISMATCH')
  }
  const followUpBatchBinding = prepared[0]?.followUpBatchBinding ?? null
  if (
    prepared.some((item) => item.followUpBatchBinding !== followUpBatchBinding)
  ) {
    throw new Error('OPERATION_TASK_FOLLOW_UP_BINDING_MISMATCH')
  }
  if (!operationExecutionTransaction) {
    throw new Error('OPERATION_TASK_EXECUTION_TRANSACTION_REQUIRED')
  }
  let persisted: Awaited<
    ReturnType<typeof persistSubmittedTaskBatchInTransaction>
  >
  const persist = async (
    tx: Prisma.TransactionClient,
  ): Promise<
    Awaited<ReturnType<typeof persistSubmittedTaskBatchInTransaction>>
  > => {
    return await persistSubmittedTaskBatchInTransaction({
      tx,
      inputs: prepared.map((item) => item.prepared.input),
      billingMode,
      onBatchCreatedInTransaction: async (transaction, tasks) => {
        for (const [index, stored] of tasks.entries()) {
          await prepared[index]?.onTaskCreatedInTransaction?.(
            transaction,
            stored.task,
          )
        }
        await followUpBatchBinding?.bindInTransaction(transaction, {
          operationId,
          taskIds: tasks.map(({ task }) => task.id),
        })
      },
    })
  }
  try {
    persisted = await persist(operationExecutionTransaction)
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      throw new ApiError('INSUFFICIENT_BALANCE', {
        message: error.message,
        required: error.required,
        available: error.available,
      }, { cause: error })
    }
    throw error
  }
  return await Promise.all(
    persisted.map(async ({ task, deduped }) => {
      if (!isTaskType(task.type))
        throw new Error(`TASK_TYPE_UNSUPPORTED:${task.type}`)
      return {
        success: true,
        async: true,
        taskId: task.id,
        taskType: task.type,
        status: task.status,
        deduped,
        billingReceiptView: await buildBillingReceiptView(
          (task.billingInfo || null) as TaskBillingInfo | null,
        ),
      } satisfies SubmitTaskResult
    }),
  )
}

export async function submitOperationTask(
  params: OperationTaskSubmissionParams,
): Promise<SubmitTaskResult> {
  const results = await submitOperationTaskBatch([params])
  const first = results[0]
  if (!first || results.length !== 1)
    throw new Error('OPERATION_TASK_SINGLE_BATCH_RESULT_INVALID')
  return first
}
