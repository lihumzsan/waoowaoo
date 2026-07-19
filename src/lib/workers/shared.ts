import { UnrecoverableError, type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { LLMStreamChunk } from '@/lib/llm-observe/types'
import { TaskTerminatedError } from '@/lib/task/errors'
import {
  touchTaskHeartbeat,
  tryMarkTaskQueuedForRetry,
  tryClaimTaskAttempt,
  tryUpdateTaskProgress,
} from '@/lib/task/service'
import { publishTaskEvent, publishTaskStreamEvent } from '@/lib/task/publisher'
import type { TaskStructuredStreamCheckpointWrite } from '@/lib/task/structured-stream-checkpoint'
import { TASK_EVENT_TYPE, type TaskJobData } from '@/lib/task/types'
import {
  getTaskMaxAttempts,
  shouldRetryTaskFailure,
  TASK_RETRY_BACKOFF_BASE_MS,
} from '@/lib/task/retry-policy'
import { buildTaskProgressMessage, getTaskStageLabel } from '@/lib/task/progress-message'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { withTextUsageCollection } from '@/lib/billing/runtime-usage'
import { onProjectNameAvailable } from '@/lib/logging/file-writer'
import { getLogContext, withLogContext } from '@/lib/logging/context'
import { commitTaskTerminal } from '@/lib/task/terminal'
import {
  loadTaskExecutionFingerprint,
  loadTaskHandlerCheckpoint,
  saveTaskHandlerCheckpoint,
} from '@/lib/task/execution-checkpoint'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readStringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readPositiveIntField(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function extractFlowFields(jobData: TaskJobData): Record<string, unknown> {
  const payload = toObject(jobData.payload)
  const flowId = readStringField(payload, 'flowId')
  const flowStageTitle = readStringField(payload, 'flowStageTitle')
  const flowStageIndex = readPositiveIntField(payload, 'flowStageIndex')
  const flowStageTotal = readPositiveIntField(payload, 'flowStageTotal')
  const payloadMeta = toObject(payload.meta)
  const runId = readStringField(payload, 'runId') || readStringField(payloadMeta, 'runId')

  return {
    ...(flowId ? { flowId } : {}),
    ...(flowStageTitle ? { flowStageTitle } : {}),
    ...(flowStageIndex ? { flowStageIndex } : {}),
    ...(flowStageTotal ? { flowStageTotal } : {}),
    ...(runId ? { runId } : {}),
  }
}

function withFlowFields(jobData: TaskJobData, payload?: Record<string, unknown> | null): Record<string, unknown> {
  const base = { ...(payload || {}) }
  const flowFields = extractFlowFields(jobData)
  for (const [key, value] of Object.entries(flowFields)) {
    if (base[key] === undefined || base[key] === null || base[key] === '') {
      base[key] = value
    }
  }
  const meta = toObject(base.meta)
  if (meta.locale === undefined || meta.locale === null || meta.locale === '') {
    base.meta = {
      ...meta,
      locale: jobData.locale,
    }
  }
  return base
}

function buildWorkerLogger(data: TaskJobData, queueName: string) {
  return createScopedLogger({
    module: `worker.${queueName}`,
    requestId: data.trace?.requestId || undefined,
    taskId: data.taskId,
    projectId: data.projectId,
    userId: data.userId,
  })
}

async function publishLifecycleEvent(params: {
  taskId: string
  projectId: string
  userId: string
  type: typeof TASK_EVENT_TYPE[keyof typeof TASK_EVENT_TYPE]
  taskType: string
  targetType: string
  targetId: string
  episodeId?: string | null
  payload?: Record<string, unknown> | null
  persist?: boolean
}) {
  await publishTaskEvent({
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    type: params.type,
    taskType: params.taskType,
    targetType: params.targetType,
    targetId: params.targetId,
    episodeId: params.episodeId || null,
    payload: params.payload,
    persist: params.persist,
  })

}

async function publishStreamEvent(params: {
  taskId: string
  projectId: string
  userId: string
  taskType: string
  targetType: string
  targetId: string
  episodeId?: string | null
  payload?: Record<string, unknown> | null
  checkpoint: TaskStructuredStreamCheckpointWrite
}) {
  await publishTaskStreamEvent({
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    taskType: params.taskType,
    targetType: params.targetType,
    targetId: params.targetId,
    episodeId: params.episodeId || null,
    payload: params.payload,
    checkpoint: params.checkpoint,
  })

}

function buildErrorCauseChain(input: unknown): Array<{ name: string; message: string }> {
  const chain: Array<{ name: string; message: string }> = []
  const seen = new Set<unknown>()
  let current: unknown = input

  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || seen.has(current)) break
    seen.add(current)
    if (!(current instanceof Error)) {
      chain.push({ name: typeof current, message: String(current) })
      break
    }
    chain.push({
      name: current.name || 'Error',
      message: current.message || '',
    })
    const next = (current as Error & { cause?: unknown }).cause
    if (!next) break
    current = next
  }

  return chain
}

async function resolveProjectNameForLogging(projectId: string): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    })
    if (project?.name) {
      onProjectNameAvailable(projectId, project.name)
    }
  } catch {
    // Swallow – log file routing failure should never crash the worker.
  }
}

export async function withTaskLifecycle(job: Job<TaskJobData>, handler: (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>) {
  const data = job.data
  const taskId = data.taskId
  const logger = buildWorkerLogger(data, job.queueName)
  const startedAt = Date.now()
  let taskAttempt: number | null = null

  // Register project name for per-project log file routing
  void resolveProjectNameForLogging(data.projectId)

  const heartbeatTimer = setInterval(() => {
    if (taskAttempt !== null) void touchTaskHeartbeat(taskId, taskAttempt)
  }, 10_000)

  try {
    logger.info({
      action: 'worker.start',
      message: 'worker started',
      details: {
        queue: job.queueName,
        taskType: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
        episodeId: data.episodeId || null,
      },
    })
    const claim = await tryClaimTaskAttempt({ taskId })
    if (claim.kind === 'already_processing') {
      logger.warn({
        action: 'worker.delivery.already_processing',
        message: 'stalled or duplicate delivery cannot claim the active DB attempt',
        details: { activeAttempt: claim.attempt },
      })
      throw new UnrecoverableError(`TASK_ATTEMPT_ALREADY_PROCESSING:${taskId}:${claim.attempt}`)
    }
    if (claim.kind === 'missing' || claim.kind === 'terminal') {
      logger.info({
        action: 'worker.skip.terminated',
        message: 'task is not active, skip worker execution',
        details: claim.kind === 'terminal'
          ? { status: claim.status, attempt: claim.attempt }
          : { status: 'missing' },
      })
      return
    }
    taskAttempt = claim.attempt
    const processingPayload = withFlowFields(data, {
      queue: job.queueName,
      stage: 'received',
      stageLabel: getTaskStageLabel('received'),
      displayMode: 'loading',
      trace: {
        requestId: data.trace?.requestId || null,
      },
    })
    await publishLifecycleEvent({
      taskId,
      projectId: data.projectId,
      userId: data.userId,
      type: TASK_EVENT_TYPE.PROCESSING,
      taskType: data.type,
      targetType: data.targetType,
      targetId: data.targetId,
      episodeId: data.episodeId || null,
      payload: {
        ...processingPayload,
        message: buildTaskProgressMessage({
          eventType: TASK_EVENT_TYPE.PROCESSING,
          taskType: data.type,
          payload: processingPayload,
        }),
      },
    })

    const inputFingerprint = await loadTaskExecutionFingerprint(taskId)
    const existingCheckpoint = await loadTaskHandlerCheckpoint({ taskId, inputFingerprint })
    const checkpoint = existingCheckpoint ?? await withLogContext({
      taskId,
      taskAttempt,
      projectId: data.projectId,
      userId: data.userId,
    }, async () => {
      const executed = await withTextUsageCollection(async () => await handler(job))
      return await saveTaskHandlerCheckpoint({
        taskId,
        inputFingerprint,
        output: { result: executed.result || null, textUsage: executed.textUsage },
      })
    })
    const { result } = checkpoint.output
    const completedPayload = withFlowFields(data, {
      ...(result || {}),
      displayMode: 'loading',
      trace: {
        requestId: data.trace?.requestId || null,
      },
    })
    const terminal = await commitTaskTerminal({
      kind: 'completed',
      taskId,
      fence: { kind: 'attempt', attempt: taskAttempt },
      executionCheckpointId: checkpoint.id,
      eventPayload: {
        ...completedPayload,
        message: buildTaskProgressMessage({
          eventType: TASK_EVENT_TYPE.COMPLETED,
          taskType: data.type,
          payload: completedPayload,
        }),
      },
    })
    logger.info({
      action: terminal.applied ? 'worker.completed' : 'worker.completed.idempotent',
      message: 'worker terminal completion committed',
      durationMs: Date.now() - startedAt,
      details: { result: result || null, terminalEventId: terminal.terminalEventId },
    })
  } catch (error: unknown) {
    if (taskAttempt === null) throw error
    if (error instanceof TaskTerminatedError) {
      logger.info({
        action: 'worker.terminated',
        message: error.message,
        durationMs: Date.now() - startedAt,
      })
      throw new UnrecoverableError(`Task terminated: ${error.message}`)
    }

    const normalizedError = normalizeAnyError(error, { context: 'worker' })
    const errorCauseChain = buildErrorCauseChain(error)
    const currentAttempt = taskAttempt
    const maxAttempts = getTaskMaxAttempts(data.type)
    const bullmqWillRetry = shouldRetryTaskFailure({
      taskType: data.type,
      failureClass: normalizedError.failureClass,
    }) && currentAttempt < maxAttempts
    const workerFailureLog = {
      action: bullmqWillRetry ? 'worker.retryable_failed' : 'worker.failed',
      message: normalizedError.message,
      errorCode: normalizedError.code,
      retryable: normalizedError.retryable,
      failureClass: normalizedError.failureClass,
      provider: normalizedError.provider || undefined,
      durationMs: Date.now() - startedAt,
      details: {
        queue: job.queueName,
        taskType: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
      },
      error:
        error instanceof Error
          ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: normalizedError.code,
            retryable: normalizedError.retryable,
            failureClass: normalizedError.failureClass,
            causeChain: errorCauseChain,
          }
          : {
            message: String(error),
            code: normalizedError.code,
            retryable: normalizedError.retryable,
            failureClass: normalizedError.failureClass,
            causeChain: errorCauseChain,
          },
    }
    logger[bullmqWillRetry ? 'warn' : 'error'](workerFailureLog)

    if (bullmqWillRetry) {
      const requeued = await tryMarkTaskQueuedForRetry(taskId, currentAttempt)
      if (requeued) {
        const nextRetryDelayMs = TASK_RETRY_BACKOFF_BASE_MS * Math.pow(2, currentAttempt - 1)
        logger.warn({
          action: 'worker.retry_scheduled',
          message: normalizedError.message,
          errorCode: normalizedError.code,
          retryable: true,
          failureClass: normalizedError.failureClass,
          durationMs: Date.now() - startedAt,
          details: {
            taskType: data.type,
            attempt: currentAttempt,
            maxAttempts,
            nextRetryDelayMs,
          },
        })
        const retryPayload = withFlowFields(data, {
          stage: 'retrying',
          stageLabel: getTaskStageLabel('retrying'),
          displayMode: 'loading',
          attempt: currentAttempt,
          maxAttempts,
          nextRetryDelayMs,
          error: normalizedError,
          trace: {
            requestId: data.trace?.requestId || null,
          },
        })
        await publishLifecycleEvent({
          taskId,
          projectId: data.projectId,
          userId: data.userId,
          type: TASK_EVENT_TYPE.PROGRESS,
          taskType: data.type,
          targetType: data.targetType,
          targetId: data.targetId,
          episodeId: data.episodeId || null,
          payload: {
            ...retryPayload,
            message: buildTaskProgressMessage({
              eventType: TASK_EVENT_TYPE.PROGRESS,
              taskType: data.type,
              payload: retryPayload,
            }),
          },
          persist: false,
        })
        throw error instanceof Error ? error : new Error(normalizedError.message || 'Task retry scheduled')
      }
      logger.info({
        action: 'worker.retry_skipped_not_processing',
        message: 'task was no longer processing when retry was scheduled',
        taskId,
        durationMs: Date.now() - startedAt,
      })
    }

    const failedPayload = withFlowFields(data, {
      error: normalizedError,
      displayMode: 'loading',
      trace: {
        requestId: data.trace?.requestId || null,
      },
    }) as Record<string, unknown>
    if (process.env.NODE_ENV !== 'production' && error instanceof Error && typeof error.stack === 'string') {
      failedPayload.errorStack = error.stack.slice(0, 8000)
    }
    await commitTaskTerminal({
      kind: 'failed',
      taskId,
      fence: { kind: 'attempt', attempt: taskAttempt },
      source: 'worker',
      errorCode: normalizedError.code,
      errorMessage: normalizedError.message,
      errorDetails: normalizedError.details,
      eventPayload: {
        ...failedPayload,
        message: normalizedError.message || buildTaskProgressMessage({
          eventType: TASK_EVENT_TYPE.FAILED,
          taskType: data.type,
          payload: failedPayload,
        }),
      },
    })

    // Re-throw as UnrecoverableError so BullMQ records the job as failed.
    // Agent-level retry must submit a new operation instead of reusing this job.
    throw new UnrecoverableError(normalizedError.message || 'Task failed')
  } finally {
    clearInterval(heartbeatTimer)
  }
}

export async function reportTaskProgress(job: Job<TaskJobData>, progress: number, payload?: Record<string, unknown>) {
  const value = Math.max(0, Math.min(99, Math.floor(progress)))
  const logger = buildWorkerLogger(job.data, job.queueName)
  const nextPayload: Record<string, unknown> = withFlowFields(job.data, payload)
  const stage = typeof nextPayload.stage === 'string' ? nextPayload.stage : null
  if (stage && typeof nextPayload.stageLabel !== 'string') {
    nextPayload.stageLabel = getTaskStageLabel(stage)
  }
  if (typeof nextPayload.displayMode !== 'string') {
    nextPayload.displayMode = 'loading'
  }
  if (typeof nextPayload.message !== 'string') {
    nextPayload.message = buildTaskProgressMessage({
      eventType: TASK_EVENT_TYPE.PROGRESS,
      taskType: job.data.type,
      progress: value,
      payload: nextPayload,
    })
  }

  logger.info({
    action: 'worker.progress',
    message: 'worker progress update',
    details: {
      progress: value,
      ...nextPayload,
    },
  })

  const taskAttempt = getLogContext().taskAttempt
  if (!Number.isInteger(taskAttempt) || (taskAttempt ?? 0) < 1) {
    throw new Error(`TASK_ATTEMPT_CONTEXT_REQUIRED:${job.data.taskId}`)
  }
  const updated = await tryUpdateTaskProgress(job.data.taskId, taskAttempt!, value, nextPayload)
  if (!updated) {
    return
  }
  await publishLifecycleEvent({
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
    type: TASK_EVENT_TYPE.PROGRESS,
    taskType: job.data.type,
    targetType: job.data.targetType,
    targetId: job.data.targetId,
    episodeId: job.data.episodeId || null,
    payload: {
      progress: value,
      ...nextPayload,
      trace: {
        requestId: job.data.trace?.requestId || null,
      },
    },
    persist: false,
  })
}

export async function reportTaskStreamChunk(
  job: Job<TaskJobData>,
  chunk: LLMStreamChunk,
  checkpoint: TaskStructuredStreamCheckpointWrite,
  payload?: Record<string, unknown>,
) {
  const mergedPayload: Record<string, unknown> = withFlowFields(job.data, {
    ...(payload || {}),
    displayMode: 'detail',
    stream: chunk,
    done: false,
    message: payload?.message || (chunk.kind === 'reasoning' ? 'progress.runtime.llm.reasoning' : 'progress.runtime.llm.output'),
  })
  await publishStreamEvent({
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
    taskType: job.data.type,
    targetType: job.data.targetType,
    targetId: job.data.targetId,
    episodeId: job.data.episodeId || null,
    payload: {
      ...mergedPayload,
      trace: {
        requestId: job.data.trace?.requestId || null,
      },
    },
    checkpoint,
  })
}
