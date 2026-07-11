import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import type { Queue } from 'bullmq'
import { buildTaskJobEnvelope, type TaskJobEnvelopeSource } from './job-envelope'
import { addTaskJob, getAllQueues } from './queues'
import { markTaskEnqueueFailed, markTaskEnqueued, sweepStaleTasks } from './service'
import { TASK_EVENT_TYPE, TASK_STATUS, type TaskJobEnvelope, type TaskJobData, type TaskStatus } from './types'
import { commitTaskTerminal, type TaskTerminalCommitResult } from './terminal'
import { enqueuePersistedTask } from './enqueue'
import { getTaskReconcilerRuntimeConfig } from '@/lib/workers/runtime-config'

const ACTIVE_STATUSES: TaskStatus[] = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]
const reconcilerConfig = getTaskReconcilerRuntimeConfig()
const RECONCILE_BATCH_SIZE = 200

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
        error:
          error instanceof Error
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

async function failOrphanedTask(task: ReconcileTask, reason: string): Promise<TaskTerminalCommitResult> {
  return await commitTaskTerminal({
    kind: 'failed',
    taskId: task.id,
    fence: { kind: 'snapshot', updatedAt: task.updatedAt },
    source: 'reconciler',
    errorCode: 'RECONCILE_ORPHAN',
    errorMessage: reason,
    eventPayload: {
      stage: 'reconciled',
      stageLabel: 'progress.stage.taskReconciled',
      message: reason,
    },
  })
}

type QueuedTaskRecovery = 'recovered' | 'failed' | 'retry_later'

async function recoverQueuedTask(task: ReconcileTask): Promise<QueuedTaskRecovery> {
  let envelope: TaskJobEnvelope
  try {
    envelope = buildTaskJobEnvelope(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const terminal = await failOrphanedTask(task, `Queued task recovery contract invalid: ${message}`)
    return terminal.applied ? 'failed' : 'retry_later'
  }

  try {
    if (task.operationExecutionId) {
      await enqueuePersistedTask({
        taskId: task.id,
        operationExecutionId: task.operationExecutionId,
      })
    } else {
      await addTaskJob(envelope.data, { priority: envelope.priority })
      await markTaskEnqueued(task.id)
    }
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

async function recoverMaterializedCompletion(task: ReconcileTask): Promise<QueuedTaskRecovery> {
  const reset = await prisma.task.updateMany({
    where: {
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt,
    },
    data: {
      status: TASK_STATUS.QUEUED,
      startedAt: null,
      heartbeatAt: null,
    },
  })
  if (reset.count !== 1) return 'retry_later'
  return await recoverQueuedTask({ ...task, status: TASK_STATUS.QUEUED })
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
      approvalGrantId: true,
      operationExecutionId: true,
      operationPlanTaskId: true,
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
    if (typeof observation === 'object' && now - task.updatedAt.getTime() < reconcilerConfig.terminalGraceMs) {
      continue
    }
    if (observation === 'absent' && now - task.updatedAt.getTime() < reconcilerConfig.missingGraceMs) {
      continue
    }

    if (observation === 'absent' && task.status === TASK_STATUS.QUEUED) {
      const recovery = await recoverQueuedTask(task)
      if (recovery === 'recovered') result.recoveredTaskIds.push(task.id)
      if (recovery === 'failed') result.failedTaskIds.push(task.id)
      continue
    }

    const reason =
      typeof observation === 'object' && observation.failedReason
        ? `Queue job ${observation.jobState} before Task terminal update: ${observation.failedReason}`
        : typeof observation === 'object'
          ? 'Queue job already terminated but DB was not updated'
          : 'Queue job absent after reconciliation grace period'
    const terminal = await failOrphanedTask(task, reason)
    if (terminal.applied) {
      result.failedTaskIds.push(task.id)
      continue
    }
    if (terminal.reason === 'completion_pending') {
      const recovery = await recoverMaterializedCompletion(task)
      if (recovery === 'recovered') result.recoveredTaskIds.push(task.id)
      if (recovery === 'failed') result.failedTaskIds.push(task.id)
    }
  }

  return result
}

async function executeTaskReconciliationCycle(): Promise<void> {
  const sweptProcessing = await sweepStaleTasks({
    processingThresholdMs: reconcilerConfig.processingTimeoutMs,
  })

  const reconciled = await reconcileActiveTasks()
  const changed = sweptProcessing.length + reconciled.failedTaskIds.length + reconciled.recoveredTaskIds.length
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
    details: { intervalMs: reconcilerConfig.intervalMs },
  })

  const execute = async () => {
    try {
      await runTaskReconciliationCycle()
    } catch (error) {
      logger.error({
        action: 'task.reconcile.error',
        message: 'Task reconciliation cycle failed',
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      })
    }
  }

  void execute()
  globalForTaskReconciler.__waoowaooTaskReconcilerTimer = setInterval(() => {
    void execute()
  }, reconcilerConfig.intervalMs)
}
