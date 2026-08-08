import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { withRetry } from '@/lib/retry'
import { TASK_STATUS, type TaskBillingInfo, type TaskStatus } from './types'
import { projectPersistedTaskProgressPayload } from './progress-payload'

const taskModel = prisma.task

function isActiveStatus(status: string) {
  return status === TASK_STATUS.QUEUED || status === TASK_STATUS.PROCESSING
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toNullableJson(value?: Prisma.InputJsonValue | Record<string, unknown> | TaskBillingInfo | null) {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value as Prisma.InputJsonValue
}

function mergeNestedRecordField(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  key: string,
) {
  const baseValue = toObject(base[key])
  const patchValue = toObject(patch[key])
  if (Object.keys(baseValue).length === 0 && Object.keys(patchValue).length === 0) return undefined
  return {
    ...baseValue,
    ...patchValue,
  }
}

function mergeTaskProgressPayload(currentPayload: unknown, progressPayload: Record<string, unknown>) {
  const current = toObject(currentPayload)
  const persistedProgressPayload = projectPersistedTaskProgressPayload(progressPayload)
  const next: Record<string, unknown> = {
    ...current,
    ...persistedProgressPayload,
  }
  const meta = mergeNestedRecordField(current, persistedProgressPayload, 'meta')
  if (meta) next.meta = meta
  const ui = mergeNestedRecordField(current, persistedProgressPayload, 'ui')
  if (ui) next.ui = ui
  return next
}

export async function getTaskById(taskId: string) {
  return await taskModel.findUnique({ where: { id: taskId } })
}

export async function queryTasks(filters: {
  userId?: string
  projectId?: string
  targetType?: string
  targetId?: string
  status?: TaskStatus[]
  type?: string[]
  limit?: number
}) {
  return await taskModel.findMany({
    where: {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.targetId ? { targetId: filters.targetId } : {}),
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(filters.type?.length ? { type: { in: filters.type } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filters.limit ?? 50,
  })
}

export async function isTaskActive(taskId: string) {
  const task = await withRetry({
    operation: EXTERNAL_OPERATION.DATABASE_READ,
    scope: 'prisma:task.isActive',
    run: async () => await taskModel.findUnique({
      where: { id: taskId },
      select: { status: true },
    }),
  })
  if (!task) return false
  return isActiveStatus(task.status)
}

function processingAttemptWhere(taskId: string, attempt: number) {
  return {
    id: taskId,
    status: TASK_STATUS.PROCESSING,
    attempt,
  }
}

export async function tryUpdateTaskProgress(
  taskId: string,
  attempt: number,
  progress: number,
  payload?: Record<string, unknown> | null,
) {
  const attemptWhere = processingAttemptWhere(taskId, attempt)
  if (payload) {
    const current = await withRetry({
      operation: EXTERNAL_OPERATION.DATABASE_READ,
      scope: 'prisma:task.progress.current',
      run: async () => await taskModel.findFirst({
        where: attemptWhere,
        select: { payload: true },
      }),
    })
    if (!current) return false
    const mergedPayload = mergeTaskProgressPayload(current.payload, payload)
    const result = await taskModel.updateMany({
      where: attemptWhere,
      data: {
        progress,
        payload: toNullableJson(mergedPayload),
      },
    })
    return result.count > 0
  }

  const result = await taskModel.updateMany({
    where: attemptWhere,
    data: {
      progress,
    },
  })
  return result.count > 0
}
