import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { RETRY_POLICY, withRetry } from '@/lib/retry'
import { TASK_STATUS, type TaskBillingInfo, type TaskStatus } from './types'
import { commitTaskTerminal } from './terminal'

const ACTIVE_STATUSES: TaskStatus[] = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]
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
  const next: Record<string, unknown> = {
    ...current,
    ...progressPayload,
  }
  const meta = mergeNestedRecordField(current, progressPayload, 'meta')
  if (meta) next.meta = meta
  const ui = mergeNestedRecordField(current, progressPayload, 'ui')
  if (ui) next.ui = ui
  return next
}

export async function getTaskById(taskId: string) {
  return await taskModel.findUnique({ where: { id: taskId } })
}

export async function queryTasks(filters: {
  projectId?: string
  targetType?: string
  targetId?: string
  status?: TaskStatus[]
  type?: string[]
  limit?: number
}) {
  return await taskModel.findMany({
    where: {
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

export async function markTaskEnqueueFailed(taskId: string, error: string) {
  return await taskModel.update({
    where: { id: taskId },
    data: {
      enqueueAttempts: { increment: 1 },
      lastEnqueueError: error.slice(0, 500),
    },
  })
}

export async function markTaskEnqueued(taskId: string) {
  return await taskModel.update({
    where: { id: taskId },
    data: {
      enqueuedAt: new Date(),
      lastEnqueueError: null,
    },
  })
}

function activeTaskWhere(taskId: string) {
  return {
    id: taskId,
    status: { in: [...ACTIVE_STATUSES] },
  }
}

export async function isTaskActive(taskId: string) {
  const task = await withRetry({
    scope: 'prisma:task.isActive',
    policy: RETRY_POLICY.prisma,
    run: async () => await taskModel.findUnique({
      where: { id: taskId },
      select: { status: true },
    }),
  })
  if (!task) return false
  return isActiveStatus(task.status)
}

export async function tryClaimTaskAttempt(params: {
  readonly taskId: string
  readonly externalId?: string | null
}): Promise<number | null> {
  const data: Prisma.TaskUpdateManyMutationInput = {
    status: TASK_STATUS.PROCESSING,
    startedAt: new Date(),
    heartbeatAt: new Date(),
    attempt: { increment: 1 },
  }
  if (params.externalId !== undefined) {
    data.externalId = params.externalId || null
  }

  return await prisma.$transaction(async (tx) => {
    const result = await tx.task.updateMany({
      where: {
        id: params.taskId,
        status: TASK_STATUS.QUEUED,
      },
      data,
    })
    if (result.count === 0) return null
    const claimed = await tx.task.findUnique({
      where: { id: params.taskId },
      select: { status: true, attempt: true },
    })
    if (!claimed || claimed.status !== TASK_STATUS.PROCESSING || claimed.attempt < 1) {
      throw new Error(`TASK_ATTEMPT_CLAIM_RESULT_INVALID:${params.taskId}`)
    }
    return claimed.attempt
  })
}

export async function trySetTaskExternalId(taskId: string, externalId: string) {
  const value = typeof externalId === 'string' ? externalId.trim() : ''
  if (!value) return false
  const result = await taskModel.updateMany({
    where: {
      ...activeTaskWhere(taskId),
      OR: [
        { externalId: null },
        { externalId: '' },
      ],
    },
    data: {
      externalId: value,
    },
  })
  return result.count > 0
}

export async function clearTaskExternalId(taskId: string) {
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      externalId: null,
    },
  })
  return result.count > 0
}

function processingAttemptWhere(taskId: string, attempt: number) {
  return {
    id: taskId,
    status: TASK_STATUS.PROCESSING,
    attempt,
  }
}

export async function touchTaskHeartbeat(taskId: string, attempt: number) {
  const result = await taskModel.updateMany({
    where: processingAttemptWhere(taskId, attempt),
    data: { heartbeatAt: new Date() },
  })
  return result.count > 0
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
      scope: 'prisma:task.progress.current',
      policy: RETRY_POLICY.prisma,
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

export async function tryMarkTaskQueuedForRetry(taskId: string, attempt: number) {
  const result = await taskModel.updateMany({
    where: {
      id: taskId,
      status: TASK_STATUS.PROCESSING,
      attempt,
    },
    data: {
      status: TASK_STATUS.QUEUED,
      startedAt: null,
      heartbeatAt: null,
    },
  })
  return result.count > 0
}

export async function cancelTask(taskId: string, reason = 'Task cancelled by user') {
  const snapshot = await taskModel.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
    },
  })
  if (!snapshot) {
    return {
      task: null,
      cancelled: false,
    }
  }

  const active = isActiveStatus(snapshot.status)
  const terminal = active
    ? await commitTaskTerminal({
        kind: 'canceled',
        taskId,
        fence: { kind: 'active' },
        source: 'user',
        reason,
        eventPayload: { stage: 'canceled', canceled: true },
      })
    : null
  const cancelled = terminal?.applied === true
  const task = await taskModel.findUnique({ where: { id: taskId } })
  return {
    task,
    cancelled,
  }
}

export async function sweepStaleTasks(params: {
  processingThresholdMs: number
  limit?: number
}) {
  const limit = Math.max(1, params.limit || 200)
  const processingBefore = new Date(Date.now() - Math.max(1, params.processingThresholdMs))

  const staleProcessing = await taskModel.findMany({
    where: {
      status: TASK_STATUS.PROCESSING,
      OR: [
        { heartbeatAt: { lt: processingBefore } },
        {
          heartbeatAt: null,
          startedAt: { lt: processingBefore },
        },
        {
          heartbeatAt: null,
          startedAt: null,
          updatedAt: { lt: processingBefore },
        },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      type: true,
      targetType: true,
      targetId: true,
      billingInfo: true,
      updatedAt: true,
    },
  })

  if (staleProcessing.length === 0) return []

  const timedOut: Array<typeof staleProcessing[number] & {
    errorCode: string
    errorMessage: string
  }> = []
  for (const task of staleProcessing) {
    const terminal = await commitTaskTerminal({
      kind: 'failed',
      taskId: task.id,
      fence: { kind: 'snapshot', updatedAt: task.updatedAt },
      source: 'timeout',
      errorCode: 'WATCHDOG_TIMEOUT',
      errorMessage: 'Task heartbeat timeout',
      eventPayload: { stage: 'reconciler_timeout' },
    })
    if (terminal.applied) {
      timedOut.push({
        ...task,
        errorCode: 'WATCHDOG_TIMEOUT',
        errorMessage: 'Task heartbeat timeout',
      })
    }
  }

  return timedOut
}

export async function dismissFailedTasks(
  taskIds: string[],
  userId: string,
  client: Pick<Prisma.TransactionClient, 'task'> = prisma,
) {
  if (taskIds.length === 0) return 0
  const result = await client.task.updateMany({
    where: {
      id: { in: taskIds },
      userId,
      status: TASK_STATUS.FAILED,
    },
    data: {
      status: TASK_STATUS.DISMISSED,
    },
  })
  return result.count
}
