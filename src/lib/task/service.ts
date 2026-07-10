import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { RETRY_POLICY, withRetry } from '@/lib/retry'
import { locales } from '@/i18n/routing'
import { TASK_STATUS, type CreateTaskInput, type TaskBillingInfo, type TaskStatus } from './types'
import { syncTaskTargetFailure } from './target-failure-sync'
import type { TaskJobObservation } from './reconcile'
import { commitTaskTerminal, type TaskTerminalCommitResult } from './terminal'
import { createTaskExecutionFingerprint } from './execution-identity'

const ACTIVE_STATUSES: TaskStatus[] = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]
const taskModel = prisma.task

async function observeJob(taskId: string): Promise<TaskJobObservation> {
  const { observeTaskJob } = await import('./reconcile')
  return await observeTaskJob(taskId)
}

function isPrismaKnownError(error: unknown): error is { code?: string } {
  return typeof error === 'object' && error !== null && 'code' in error
}

function isActiveStatus(status: string) {
  return status === TASK_STATUS.QUEUED || status === TASK_STATUS.PROCESSING
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeLocale(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  for (const locale of locales) {
    if (normalized === locale || normalized.startsWith(`${locale}-`)) {
      return locale
    }
  }
  return null
}

function hasTaskLocale(payload: unknown): boolean {
  const payloadObject = toObject(payload)
  const payloadMeta = toObject(payloadObject.meta)
  const locale = normalizeLocale(payloadMeta.locale) || normalizeLocale(payloadObject.locale)
  return locale !== null
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

async function failTaskWithMissingLocale(task: {
  id: string
  updatedAt: Date
}) {
  await commitTaskTerminal({
    kind: 'failed',
    taskId: task.id,
    fence: { kind: 'active' },
    source: 'validation',
    errorCode: 'TASK_LOCALE_REQUIRED',
    errorMessage: 'task locale is missing',
    eventPayload: { stage: 'validation_failed' },
  })
}

async function failObservedOrphanTask(
  task: { id: string; updatedAt: Date },
  message: string,
): Promise<TaskTerminalCommitResult> {
  return await commitTaskTerminal({
    kind: 'failed',
    taskId: task.id,
    fence: { kind: 'snapshot', updatedAt: task.updatedAt },
    source: 'reconciler',
    errorCode: 'RECONCILE_ORPHAN',
    errorMessage: message,
    eventPayload: { stage: 'dedupe_orphan_reconciled' },
  })
}

async function resolveObservedOrphanTask(
  task: { id: string; updatedAt: Date },
  message: string,
) {
  const result = await failObservedOrphanTask(task, message)
  if (result.applied) return null

  const latest = await taskModel.findUnique({ where: { id: task.id } })
  if (!latest) return null
  if (isActiveStatus(latest.status)) {
    // A heartbeat/re-enqueue won the snapshot race. It remains the authoritative
    // active Task; a caller must not create another row with the same dedupe key.
    return latest
  }

  // A concurrent terminal commit owns the replacement decision and clears the
  // unique key in the same transaction. Refuse to create until that handoff is
  // visible instead of treating a P2002 collision as a retry signal.
  if (latest.dedupeKey !== null) {
    throw new Error(`TASK_TERMINAL_DEDUPE_NOT_RELEASED:${latest.id}`)
  }
  return null
}

export async function createTask(input: CreateTaskInput) {
  const model = taskModel

  if (input.dedupeKey) {
    const existing = await model.findFirst({
      where: {
        dedupeKey: input.dedupeKey,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      if (isActiveStatus(existing.status)) {
        if (!hasTaskLocale(existing.payload)) {
          await failTaskWithMissingLocale(existing)
        } else {
          // 校验 BullMQ Job 是否真的还活着，防止 DB 与队列状态脱节导致永久卡死
          const jobObservation = await observeJob(existing.id)
          if (jobObservation === 'unavailable') {
            return { task: existing, deduped: true as const }
          }
          if (jobObservation === 'alive') {
            if (input.batchKey && existing.batchKey !== input.batchKey) {
              const updated = await model.update({
                where: { id: existing.id },
                data: { batchKey: input.batchKey },
              })
              return { task: updated, deduped: true as const }
            }
            return { task: existing, deduped: true as const }
          }

          const authoritative = await resolveObservedOrphanTask(
            existing,
            'Queue job lost, replaced by new task',
          )
          if (authoritative) return { task: authoritative, deduped: true as const }
        }
      } else {
        // dedupeKey is unique in DB. Release terminal-task key so a new task can be created.
        await model.update({
          where: { id: existing.id },
          data: { dedupeKey: null },
        })
      }
    }
  }

  const createData = {
    userId: input.userId,
    projectId: input.projectId,
    parentTaskId: input.parentTaskId || null,
    episodeId: input.episodeId || null,
    type: input.type,
    targetType: input.targetType,
    targetId: input.targetId,
    status: TASK_STATUS.QUEUED,
    progress: 0,
    attempt: 0,
    priority: input.priority ?? 0,
    dedupeKey: input.dedupeKey || null,
    batchKey: input.batchKey || null,
    operationId: input.operationId || null,
    operationSource: input.operationSource || null,
    operationConfirmed: input.operationConfirmed ?? null,
    operationRequestId: input.operationRequestId || null,
    payload: toNullableJson(input.payload ?? null),
    executionFingerprint: createTaskExecutionFingerprint(input),
    billingInfo: toNullableJson(input.billingInfo ?? null),
    queuedAt: new Date(),
  }

  try {
    const task = await model.create({ data: createData })
    return { task, deduped: false as const }
  } catch (error: unknown) {
    if (input.dedupeKey && isPrismaKnownError(error) && error.code === 'P2002') {
      const collided = await model.findFirst({
        where: { dedupeKey: input.dedupeKey },
        orderBy: { createdAt: 'desc' },
      })

      if (collided) {
        if (isActiveStatus(collided.status)) {
          if (!hasTaskLocale(collided.payload)) {
            await failTaskWithMissingLocale(collided)
          } else {
            // P2002 竞态路径：同样校验 BullMQ Job 状态
            const jobObservation = await observeJob(collided.id)
            if (jobObservation === 'unavailable') {
              return { task: collided, deduped: true as const }
            }
            if (jobObservation === 'alive') {
              if (input.batchKey && collided.batchKey !== input.batchKey) {
                const updated = await model.update({
                  where: { id: collided.id },
                  data: { batchKey: input.batchKey },
                })
                return { task: updated, deduped: true as const }
              }
              return { task: collided, deduped: true as const }
            }

            const authoritative = await resolveObservedOrphanTask(
              collided,
              'Queue job lost, replaced by new task',
            )
            if (authoritative) return { task: authoritative, deduped: true as const }
          }
        } else {
          await model.update({
            where: { id: collided.id },
            data: { dedupeKey: null },
          })
        }

        const task = await model.create({ data: createData })
        return { task, deduped: false as const }
      }
    }

    throw error
  }
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

export async function getActiveTasksForTarget(params: {
  targetType: string
  targetId: string
  projectId?: string
}) {
  return await taskModel.findMany({
    where: {
      targetType: params.targetType,
      targetId: params.targetId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      status: { in: [...ACTIVE_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
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

export async function updateTaskBillingInfo(taskId: string, billingInfo: TaskBillingInfo | null) {
  return await taskModel.update({
    where: { id: taskId },
    data: {
      billingInfo: toNullableJson(billingInfo as unknown as Prisma.InputJsonValue),
    },
  })
}

export async function updateTaskPayload(taskId: string, payload: Record<string, unknown> | null) {
  return await taskModel.update({
    where: { id: taskId },
    data: {
      payload: toNullableJson(payload as unknown as Prisma.InputJsonValue),
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

export async function tryMarkTaskProcessing(taskId: string, externalId?: string | null) {
  const data: Prisma.TaskUpdateManyMutationInput = {
    status: TASK_STATUS.PROCESSING,
    startedAt: new Date(),
    heartbeatAt: new Date(),
    attempt: { increment: 1 },
  }
  if (externalId !== undefined) {
    data.externalId = externalId || null
  }

  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data,
  })
  return result.count > 0
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

export async function touchTaskHeartbeat(taskId: string) {
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: { heartbeatAt: new Date() },
  })
  return result.count > 0
}

export async function tryUpdateTaskProgress(taskId: string, progress: number, payload?: Record<string, unknown> | null) {
  if (payload) {
    const current = await withRetry({
      scope: 'prisma:task.progress.current',
      policy: RETRY_POLICY.prisma,
      run: async () => await taskModel.findFirst({
        where: activeTaskWhere(taskId),
        select: { payload: true },
      }),
    })
    if (!current) return false
    const mergedPayload = mergeTaskProgressPayload(current.payload, payload)
    const result = await taskModel.updateMany({
      where: activeTaskWhere(taskId),
      data: {
        progress,
        payload: toNullableJson(mergedPayload),
      },
    })
    return result.count > 0
  }

  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      progress,
    },
  })
  return result.count > 0
}

export async function tryMarkTaskQueuedForRetry(taskId: string) {
  const result = await taskModel.updateMany({
    where: {
      id: taskId,
      status: TASK_STATUS.PROCESSING,
    },
    data: {
      status: TASK_STATUS.QUEUED,
      startedAt: null,
      heartbeatAt: null,
    },
  })
  return result.count > 0
}

export async function markTaskProcessing(taskId: string, externalId?: string | null) {
  return await tryMarkTaskProcessing(taskId, externalId)
}

export async function updateTaskProgress(taskId: string, progress: number, payload?: Record<string, unknown> | null) {
  return await tryUpdateTaskProgress(taskId, progress, payload)
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

  const finishedAt = new Date()
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

export async function dismissFailedTasks(taskIds: string[], userId: string) {
  if (taskIds.length === 0) return 0
  const result = await taskModel.updateMany({
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
