import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import type { Queue } from 'bullmq'
import { buildTaskJobEnvelope, type TaskJobEnvelopeSource } from './job-envelope'
import { addTaskJob, getAllQueues } from './queues'
import { publishTaskEvent } from './publisher'
import {
  markTaskEnqueueFailed,
  markTaskEnqueued,
  rollbackTaskBillingForTask,
  sweepStaleTasks,
} from './service'
import { syncTaskTargetFailure } from './target-failure-sync'
import {
  TASK_EVENT_TYPE,
  TASK_STATUS,
  type TaskJobEnvelope,
  type TaskJobData,
  type TaskStatus,
} from './types'

const ACTIVE_STATUSES: TaskStatus[] = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]
const RECONCILE_INTERVAL_MS = 60_000
const PROCESSING_TIMEOUT_MS = 5 * 60_000
const RECONCILE_BATCH_SIZE = 200
const TERMINAL_RECONCILE_GRACE_MS = 90_000
const MISSING_RECONCILE_GRACE_MS = 30_000

export type TaskJobObservation =
  | 'alive'
  | 'absent'
  | 'unavailable'
  | {
    state: 'terminal'
    jobState: 'completed' | 'failed'
    failedReason: string | null
  }

export type TaskReconciliationResult = {
  failedTaskIds: string[]
  recoveredTaskIds: string[]
  unavailableTaskIds: string[]
}

const logger = createScopedLogger({ module: 'task.reconciler' })

/**
 * BullMQ observation is intentionally four-state. Infrastructure failure is not
 * evidence that a job is absent and must never release a dedupe key.
 */
export async function observeTaskJobAcrossQueues(
  taskId: string,
  queues: readonly Pick<Queue<TaskJobData>, 'getJob'>[],
): Promise<TaskJobObservation> {
  let unavailable = false
  for (const queue of queues) {
    try {
      const job = await queue.getJob(taskId)
      if (!job) continue
      const state = await job.getState()
      if (state === 'completed' || state === 'failed') {
        return {
          state: 'terminal',
          jobState: state,
          failedReason: job.failedReason || null,
        }
      }
      return 'alive'
    } catch (error) {
      unavailable = true
      logger.error({
        action: 'task.job.observe_failed',
        message: 'BullMQ job observation failed',
        taskId,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
      })
    }
  }
  return unavailable ? 'unavailable' : 'absent'
}

export async function observeTaskJob(taskId: string): Promise<TaskJobObservation> {
  return await observeTaskJobAcrossQueues(taskId, getAllQueues())
}

type ReconcileTask = TaskJobEnvelopeSource & {
  status: string
  updatedAt: Date
}

async function failOrphanedTask(task: ReconcileTask, reason: string): Promise<boolean> {
  const rollbackResult = await rollbackTaskBillingForTask({
    taskId: task.id,
    billingInfo: task.billingInfo,
  })
  const compensationFailed = rollbackResult.attempted && !rollbackResult.rolledBack
  const errorCode = compensationFailed ? 'BILLING_COMPENSATION_FAILED' : 'RECONCILE_ORPHAN'
  const errorMessage = compensationFailed ? `${reason}; billing rollback failed` : reason

  const result = await prisma.task.updateMany({
    where: {
      id: task.id,
      status: { in: ACTIVE_STATUSES },
    },
    data: {
      status: TASK_STATUS.FAILED,
      errorCode,
      errorMessage,
      finishedAt: new Date(),
      heartbeatAt: null,
      dedupeKey: null,
    },
  })

  if (result.count === 0) return false

  await syncTaskTargetFailure({
    type: task.type,
    targetType: task.targetType,
    targetId: task.targetId,
    errorCode,
    errorMessage,
  })
  await publishTaskEvent({
    taskId: task.id,
    projectId: task.projectId,
    userId: task.userId,
    type: TASK_EVENT_TYPE.FAILED,
    taskType: task.type,
    targetType: task.targetType,
    targetId: task.targetId,
    episodeId: task.episodeId,
    payload: {
      stage: 'reconciled',
      stageLabel: 'progress.stage.taskReconciled',
      message: errorMessage,
      compensationFailed,
    },
  })
  return true
}

type QueuedTaskRecovery = 'recovered' | 'failed' | 'retry_later'

async function recoverQueuedTask(task: ReconcileTask): Promise<QueuedTaskRecovery> {
  let envelope: TaskJobEnvelope
  try {
    envelope = buildTaskJobEnvelope(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return await failOrphanedTask(task, `Queued task recovery contract invalid: ${message}`)
      ? 'failed'
      : 'retry_later'
  }

  try {
    await addTaskJob(envelope.data, { priority: envelope.priority })
    await markTaskEnqueued(task.id)
    return 'recovered'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markTaskEnqueueFailed(task.id, message || 're-enqueue failed')
    logger.error({
      action: 'task.reconcile.reenqueue_failed',
      message: message || 're-enqueue failed',
      taskId: task.id,
      projectId: task.projectId,
      userId: task.userId,
      errorCode: 'EXTERNAL_ERROR',
      retryable: true,
    })
    return 'retry_later'
  }
}

export async function reconcileActiveTasks(): Promise<TaskReconciliationResult> {
  const now = Date.now()
  const activeTasks = await prisma.task.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    select: {
      id: true,
      parentTaskId: true,
      userId: true,
      projectId: true,
      episodeId: true,
      type: true,
      targetType: true,
      targetId: true,
      status: true,
      payload: true,
      batchKey: true,
      billingInfo: true,
      priority: true,
      operationId: true,
      operationSource: true,
      operationConfirmed: true,
      operationRequestId: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
    take: RECONCILE_BATCH_SIZE,
  })

  const result: TaskReconciliationResult = {
    failedTaskIds: [],
    recoveredTaskIds: [],
    unavailableTaskIds: [],
  }

  for (const task of activeTasks) {
    const observation = await observeTaskJob(task.id)
    if (observation === 'alive') continue
    if (observation === 'unavailable') {
      result.unavailableTaskIds.push(task.id)
      continue
    }
    if (
      typeof observation === 'object'
      && now - task.updatedAt.getTime() < TERMINAL_RECONCILE_GRACE_MS
    ) {
      continue
    }
    if (
      observation === 'absent'
      && now - task.updatedAt.getTime() < MISSING_RECONCILE_GRACE_MS
    ) {
      continue
    }

    if (observation === 'absent' && task.status === TASK_STATUS.QUEUED) {
      const recovery = await recoverQueuedTask(task)
      if (recovery === 'recovered') result.recoveredTaskIds.push(task.id)
      if (recovery === 'failed') result.failedTaskIds.push(task.id)
      continue
    }

    const reason = typeof observation === 'object' && observation.failedReason
      ? `Queue job ${observation.jobState} before Task terminal update: ${observation.failedReason}`
      : typeof observation === 'object'
        ? 'Queue job already terminated but DB was not updated'
        : 'Queue job absent after reconciliation grace period'
    if (await failOrphanedTask(task, reason)) {
      result.failedTaskIds.push(task.id)
    }
  }

  return result
}

async function executeTaskReconciliationCycle(): Promise<void> {
  const sweptProcessing = await sweepStaleTasks({
    processingThresholdMs: PROCESSING_TIMEOUT_MS,
  })
  for (const task of sweptProcessing) {
    await publishTaskEvent({
      taskId: task.id,
      projectId: task.projectId,
      userId: task.userId,
      type: TASK_EVENT_TYPE.FAILED,
      taskType: task.type,
      targetType: task.targetType,
      targetId: task.targetId,
      episodeId: task.episodeId || null,
      payload: {
        stage: 'reconciler_timeout',
        stageLabel: 'progress.stage.taskTimeout',
        message: task.errorMessage,
        errorCode: task.errorCode,
        compensationFailed: task.errorCode === 'BILLING_COMPENSATION_FAILED',
      },
    })
  }

  const reconciled = await reconcileActiveTasks()
  const changed = sweptProcessing.length
    + reconciled.failedTaskIds.length
    + reconciled.recoveredTaskIds.length
  if (changed > 0 || reconciled.unavailableTaskIds.length > 0) {
    logger.info({
      action: 'task.reconcile.cycle',
      message: 'Task reconciliation cycle completed',
      details: {
        timedOut: sweptProcessing.length,
        failed: reconciled.failedTaskIds.length,
        recovered: reconciled.recoveredTaskIds.length,
        unavailable: reconciled.unavailableTaskIds.length,
      },
    })
  }
}

let activeReconciliationCycle: Promise<void> | null = null

export function runTaskReconciliationCycle(): Promise<void> {
  if (activeReconciliationCycle) {
    logger.warn({
      action: 'task.reconcile.overlap_skipped',
      message: 'Task reconciliation cycle is already running',
    })
    return activeReconciliationCycle
  }

  activeReconciliationCycle = executeTaskReconciliationCycle().finally(() => {
    activeReconciliationCycle = null
  })
  return activeReconciliationCycle
}

const globalForTaskReconciler = globalThis as typeof globalThis & {
  __waoowaooTaskReconcilerTimer?: ReturnType<typeof setInterval>
}

export function startTaskReconciler(): void {
  if (globalForTaskReconciler.__waoowaooTaskReconcilerTimer) return
  logger.info({
    action: 'task.reconcile.start',
    message: 'Task reconciler started',
    details: { intervalMs: RECONCILE_INTERVAL_MS },
  })

  const execute = async () => {
    try {
      await runTaskReconciliationCycle()
    } catch (error) {
      logger.error({
        action: 'task.reconcile.error',
        message: 'Task reconciliation cycle failed',
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
      })
    }
  }

  void execute()
  globalForTaskReconciler.__waoowaooTaskReconcilerTimer = setInterval(() => {
    void execute()
  }, RECONCILE_INTERVAL_MS)
}
