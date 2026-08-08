import { randomUUID } from 'node:crypto'
import {
  activityInfo,
  ApplicationFailure,
  CancelledFailure,
  Context,
  heartbeat,
} from '@temporalio/activity'
import { Prisma } from '@prisma/client'
import { withTextUsageCollection, type TextUsageEntry } from '@/lib/billing/runtime-usage'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import {
  createFailureRecord,
  parseFailureRecord,
} from '@/lib/errors/failure'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { withLogContext } from '@/lib/logging/context'
import { createScopedLogger } from '@/lib/logging/core'
import { getTemporalClient } from '@/lib/temporal/client'
import { encodeTemporalFailure, temporalInvariantFailure } from '@/lib/temporal/failure'
import { buildTaskWorkflowId, buildUserTaskSchedulerWorkflowId } from '@/lib/temporal/identity'
import { prisma } from '@/lib/prisma'
import { getTaskDefinition } from '@/lib/task/definition'
import {
  loadTaskExecutionFingerprint,
  loadTaskHandlerCheckpoint,
  saveTaskHandlerCheckpoint,
} from '@/lib/task/execution-checkpoint'
import { buildTaskExecutionData } from '@/lib/task/execution-input'
import { publishPersistedTaskEventById } from '@/lib/task/publisher'
import { shouldRetryTaskFailure, TASK_RETRY_BACKOFF_BASE_MS } from '@/lib/task/retry-policy'
import {
  commitTaskTerminal as commitBusinessTaskTerminal,
  type TaskTerminalCommitResult,
} from '@/lib/task/terminal'
import {
  loadReadyFollowUpBatchIdsForTerminal,
} from '@/lib/agent-turn/follow-up-batch'
import { requestAssistantRuntimeTaskFollowUp } from '@/lib/assistant-runtime/task-follow-up-http'
import { TASK_EVENT_TYPE, TASK_STATUS, type TaskExecutionData } from '@/lib/task/types'
import { executeTaskHandler } from '@/lib/task/execution/registry'
import { projectTaskProgress } from '@/lib/task/execution/progress'
import type { TaskExecutionContext, TaskExecutionResult } from '@/lib/task/execution/context'
import { TaskTerminatedError } from '@/lib/task/errors'
import { cancelAcceptedTaskProviderJobsAfterTerminal } from '@/lib/task/execution/provider-media'
import type {
  CancelTaskProviderJobsInput,
  CommitTaskTerminalInput,
  CommitTaskWorkflowFailureInput,
  BeginTaskAttemptInput,
  InitializeTaskWorkflowInput,
  InitializeTaskWorkflowResult,
  NotifyTaskFollowUpInput,
  ReportTaskRetryInput,
  ReleaseTaskCapacityInput,
  RunTaskAttemptInput,
  RunTaskAttemptResult,
  SchedulerCapacityRelease,
  TaskAttemptFailure,
  TaskSchedulerAdmission,
  TaskTerminalReceipt,
  TaskWorkflowInput,
  TaskWorkflowResult,
  UserTaskSchedulerView,
} from '../task/contracts'
import { USER_TASK_SCHEDULER_UPDATE_NAME } from '../task/contracts'

const TASK_TERMINAL_EVENT_KEY_PREFIX = 'task-terminal:'
const TASK_ATTEMPT_FAILURE_STEP_KEY_PREFIX = '__temporal_attempt_failure__:'
const TASK_ACTIVITY_HEARTBEAT_INTERVAL_MS = 10_000

const logger = createScopedLogger({ module: 'temporal.activities.task' })

type WorkflowTaskRow = {
  id: string
  parentTaskId: string | null
  type: string
  projectId: string
  targetType: string
  targetId: string
  payload: unknown
  billingInfo: unknown
  userId: string
  operationId: string | null
  operationSource: string | null
  approvalGrantId: string | null
  operationExecutionId: string | null
  operationPlanTaskId: string | null
  operationRequestId: string | null
  status: string
  progress: number
  attempt: number
  executionFingerprint: string | null
}

interface AttemptFailureCheckpoint {
  readonly version: 1
  readonly workflowId: string
  readonly attemptId: string
  readonly attempt: number
  readonly failure: TaskAttemptFailure
}

interface TaskActivityHeartbeat {
  readonly version: 1
  readonly workflowId: string
  readonly taskId: string
  readonly attemptId: string
  readonly businessAttempt: number
}

type TaskIdentity = Pick<TaskWorkflowInput, 'workflowId' | 'taskId' | 'userId' | 'taskType'>

function failNonRetryable(code: string, ...details: unknown[]): never {
  const encoded = encodeTemporalFailure(temporalInvariantFailure(code, details))
  throw ApplicationFailure.nonRetryable(encoded.message, encoded.type, ...encoded.details)
}

function requireNonEmpty(value: string, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized !== value) {
    return failNonRetryable(code)
  }
  return normalized
}

function requirePositiveInt(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return failNonRetryable(code, value)
  }
  return value
}

function requireTaskWorkflowIdentity(input: TaskIdentity): void {
  requireNonEmpty(input.workflowId, 'TASK_WORKFLOW_ID_INVALID')
  requireNonEmpty(input.taskId, 'TASK_ID_INVALID')
  requireNonEmpty(input.userId, 'TASK_USER_ID_INVALID')
  const expectedWorkflowId = buildTaskWorkflowId(input.taskId)
  if (input.workflowId !== expectedWorkflowId) {
    failNonRetryable('TASK_WORKFLOW_ID_MISMATCH', input.workflowId, expectedWorkflowId)
  }
}

function requireCurrentWorkflow(workflowId: string, code: string): void {
  const currentWorkflowId = activityInfo().workflowExecution?.workflowId
  if (!currentWorkflowId || currentWorkflowId !== workflowId) {
    failNonRetryable(code, currentWorkflowId ?? null, workflowId)
  }
}

function requireTaskActivity(input: TaskIdentity): void {
  requireTaskWorkflowIdentity(input)
  requireCurrentWorkflow(input.workflowId, 'TASK_ACTIVITY_WORKFLOW_ID_MISMATCH')
}

function requireSchedulerActivity(schedulerWorkflowId: string, userId: string): void {
  requireNonEmpty(schedulerWorkflowId, 'TASK_SCHEDULER_WORKFLOW_ID_INVALID')
  const expectedWorkflowId = buildUserTaskSchedulerWorkflowId(userId)
  if (schedulerWorkflowId !== expectedWorkflowId) {
    failNonRetryable('TASK_SCHEDULER_WORKFLOW_ID_MISMATCH', schedulerWorkflowId, expectedWorkflowId)
  }
  requireCurrentWorkflow(schedulerWorkflowId, 'TASK_SCHEDULER_ACTIVITY_WORKFLOW_ID_MISMATCH')
}

function terminalStatus(status: string): TaskWorkflowResult['status'] | null {
  if (status === TASK_STATUS.COMPLETED) return 'completed'
  if (status === TASK_STATUS.CANCELED) return 'canceled'
  if (status === TASK_STATUS.FAILED || status === TASK_STATUS.DISMISSED) {
    return 'failed'
  }
  return null
}

function expectedTerminalEventType(status: TaskWorkflowResult['status']): string {
  if (status === 'completed') return TASK_EVENT_TYPE.COMPLETED
  if (status === 'canceled') return TASK_EVENT_TYPE.CANCELED
  return TASK_EVENT_TYPE.FAILED
}

async function loadTaskRow(taskId: string): Promise<WorkflowTaskRow> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      parentTaskId: true,
      type: true,
      projectId: true,
      targetType: true,
      targetId: true,
      payload: true,
      billingInfo: true,
      userId: true,
      operationId: true,
      operationSource: true,
      approvalGrantId: true,
      operationExecutionId: true,
      operationPlanTaskId: true,
      operationRequestId: true,
      status: true,
      progress: true,
      attempt: true,
      executionFingerprint: true,
    },
  })
  if (!task) return failNonRetryable('TASK_NOT_FOUND', taskId)
  return task
}

function requireTaskRowIdentity(row: WorkflowTaskRow, input: TaskIdentity): TaskExecutionData {
  if (row.id !== input.taskId || row.userId !== input.userId || row.type !== input.taskType) {
    return failNonRetryable(
      'TASK_WORKFLOW_IDENTITY_MISMATCH',
      input.taskId,
      input.userId,
      input.taskType,
      row.id,
      row.userId,
      row.type,
    )
  }
  const data = buildTaskExecutionData(row)
  if (
    data.taskId !== input.taskId ||
    data.userId !== input.userId ||
    data.type !== input.taskType
  ) {
    return failNonRetryable('TASK_EXECUTION_DATA_IDENTITY_MISMATCH', input.taskId)
  }
  return data
}

async function terminalResultFromRow(row: WorkflowTaskRow): Promise<TaskWorkflowResult> {
  const status = terminalStatus(row.status)
  if (!status) {
    return failNonRetryable('TASK_TERMINAL_STATUS_INVALID', row.id, row.status)
  }
  const event = await prisma.taskEvent.findUnique({
    where: {
      idempotencyKey: `${TASK_TERMINAL_EVENT_KEY_PREFIX}${row.id}`,
    },
    select: { id: true, eventType: true },
  })
  if (!event || event.eventType !== expectedTerminalEventType(status)) {
    return failNonRetryable('TASK_TERMINAL_EVENT_MISSING', row.id, row.status)
  }
  if (!Number.isSafeInteger(row.attempt) || row.attempt < 0) {
    return failNonRetryable('TASK_ATTEMPT_INVALID', row.id, row.attempt)
  }
  return {
    taskId: row.id,
    status,
    attempts: row.attempt,
    terminal: {
      taskId: row.id,
      status,
      terminalEventId: event.id,
      readyFollowUpBatchIds: await loadReadyFollowUpBatchIdsForTerminal({
        taskId: row.id,
        terminalEventId: event.id,
      }),
    },
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  )
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function parseAttemptFailureCheckpoint(
  value: unknown,
  expected: {
    workflowId: string
    attemptId: string
    attempt: number
  },
): AttemptFailureCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failNonRetryable('TASK_ATTEMPT_FAILURE_CHECKPOINT_INVALID')
  }
  const record = value as Record<string, unknown>
  const failure = record.failure
  if (
    record.version !== 1 ||
    record.workflowId !== expected.workflowId ||
    record.attemptId !== expected.attemptId ||
    record.attempt !== expected.attempt ||
    !failure ||
    typeof failure !== 'object' ||
    Array.isArray(failure)
  ) {
    return failNonRetryable('TASK_ATTEMPT_FAILURE_CHECKPOINT_DIVERGED')
  }
  const parsed = failure as Record<string, unknown>
  const parsedFailure = parseFailureRecord(parsed.failure)
  if (
    !parsedFailure ||
    (parsed.retryDisposition !== 'retryable' && parsed.retryDisposition !== 'final')
  ) {
    return failNonRetryable('TASK_ATTEMPT_FAILURE_CHECKPOINT_INVALID')
  }
  return {
    version: 1,
    workflowId: expected.workflowId,
    attemptId: expected.attemptId,
    attempt: expected.attempt,
    failure: {
      failure: parsedFailure,
      retryDisposition: parsed.retryDisposition,
    },
  }
}

function attemptFailureStepKey(attempt: number): string {
  return `${TASK_ATTEMPT_FAILURE_STEP_KEY_PREFIX}${String(attempt)}`
}

async function loadAttemptFailureCheckpoint(input: {
  taskId: string
  inputFingerprint: string
  workflowId: string
  attemptId: string
  attempt: number
}): Promise<AttemptFailureCheckpoint | null> {
  const row = await prisma.taskExecutionCheckpoint.findUnique({
    where: {
      taskId_stepKey: {
        taskId: input.taskId,
        stepKey: attemptFailureStepKey(input.attempt),
      },
    },
    select: {
      inputFingerprint: true,
      state: true,
      output: true,
    },
  })
  if (!row) return null
  if (row.inputFingerprint !== input.inputFingerprint || row.state !== 'ready') {
    return failNonRetryable('TASK_ATTEMPT_FAILURE_CHECKPOINT_CONFLICT', input.taskId, input.attempt)
  }
  return parseAttemptFailureCheckpoint(row.output, input)
}

async function saveAttemptFailureCheckpoint(input: {
  taskId: string
  inputFingerprint: string
  checkpoint: AttemptFailureCheckpoint
}): Promise<AttemptFailureCheckpoint> {
  const serialized = JSON.parse(canonicalJson(input.checkpoint)) as Prisma.InputJsonValue
  try {
    const row = await prisma.taskExecutionCheckpoint.create({
      data: {
        id: randomUUID(),
        taskId: input.taskId,
        stepKey: attemptFailureStepKey(input.checkpoint.attempt),
        inputFingerprint: input.inputFingerprint,
        state: 'ready',
        output: serialized,
        completedAt: new Date(),
      },
      select: { output: true },
    })
    return parseAttemptFailureCheckpoint(row.output, input.checkpoint)
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error
    }
    const existing = await loadAttemptFailureCheckpoint({
      taskId: input.taskId,
      inputFingerprint: input.inputFingerprint,
      workflowId: input.checkpoint.workflowId,
      attemptId: input.checkpoint.attemptId,
      attempt: input.checkpoint.attempt,
    })
    if (!existing || canonicalJson(existing) !== canonicalJson(input.checkpoint)) {
      return failNonRetryable(
        'TASK_ATTEMPT_FAILURE_CHECKPOINT_COLLISION',
        input.taskId,
        input.checkpoint.attempt,
      )
    }
    return existing
  }
}

async function claimBusinessAttempt(input: BeginTaskAttemptInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.task.findUnique({
      where: { id: input.taskId },
      select: { status: true, attempt: true },
    })
    if (!current) return failNonRetryable('TASK_NOT_FOUND', input.taskId)
    if (current.status === TASK_STATUS.PROCESSING && current.attempt === input.attempt) {
      return
    }
    const previousAttempt = input.attempt - 1
    const allowedStatus = input.attempt === 1 ? TASK_STATUS.QUEUED : TASK_STATUS.PROCESSING
    if (current.status !== allowedStatus || current.attempt !== previousAttempt) {
      return failNonRetryable(
        'TASK_ATTEMPT_CLAIM_DIVERGED',
        input.taskId,
        input.attempt,
        current.status,
        current.attempt,
      )
    }
    const updated = await tx.task.updateMany({
      where: {
        id: input.taskId,
        status: allowedStatus,
        attempt: previousAttempt,
      },
      data: {
        status: TASK_STATUS.PROCESSING,
        attempt: input.attempt,
        startedAt: new Date(),
      },
    })
    if (updated.count !== 1) {
      return failNonRetryable('TASK_ATTEMPT_CLAIM_CONFLICT', input.taskId, input.attempt)
    }
  })
}

function heartbeatPayload(input: RunTaskAttemptInput): TaskActivityHeartbeat {
  return {
    version: 1,
    workflowId: input.workflowId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    businessAttempt: input.attempt,
  }
}

function assertHeartbeatIdentity(value: unknown, input: RunTaskAttemptInput): void {
  if (value === undefined || value === null) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failNonRetryable('TASK_ACTIVITY_HEARTBEAT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (
    record.version !== 1 ||
    record.workflowId !== input.workflowId ||
    record.taskId !== input.taskId ||
    record.attemptId !== input.attemptId ||
    record.businessAttempt !== input.attempt
  ) {
    failNonRetryable('TASK_ACTIVITY_HEARTBEAT_DIVERGED')
  }
}

async function terminalReceiptFromCommit(
  taskId: string,
  expectedStatus: TaskWorkflowResult['status'],
  result: TaskTerminalCommitResult,
): Promise<TaskTerminalReceipt> {
  let receipt: TaskTerminalReceipt
  if (result.applied) {
    if (result.status !== expectedStatus) {
      return failNonRetryable(
        'TASK_TERMINAL_STATUS_DIVERGED',
        taskId,
        result.status,
        expectedStatus,
      )
    }
    receipt = {
      taskId,
      status: expectedStatus,
      terminalEventId: result.terminalEventId,
      readyFollowUpBatchIds: [...result.readyFollowUpBatchIds],
    }
  } else {
    if (result.reason !== 'already_terminal') {
      return failNonRetryable(
        'TASK_TERMINAL_COMMIT_REJECTED',
        taskId,
        result.reason,
        result.existingStatus,
      )
    }
    const existingStatus = terminalStatus(result.existingStatus)
    if (
      existingStatus !== expectedStatus ||
      !Number.isSafeInteger(result.terminalEventId) ||
      result.terminalEventId <= 0
    ) {
      return failNonRetryable(
        'TASK_TERMINAL_REPLAY_DIVERGED',
        taskId,
        result.existingStatus,
        expectedStatus,
      )
    }
    receipt = {
      taskId,
      status: expectedStatus,
      terminalEventId: result.terminalEventId,
      readyFollowUpBatchIds: [...result.readyFollowUpBatchIds],
    }
  }
  try {
    await publishPersistedTaskEventById(receipt.terminalEventId, taskId)
  } catch (error) {
    Context.current().log.warn(
      'task terminal event live publication failed; durable replay remains authoritative',
      {
        taskId,
        eventId: receipt.terminalEventId,
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
  return receipt
}

export async function initializeTaskWorkflow(
  input: InitializeTaskWorkflowInput,
): Promise<InitializeTaskWorkflowResult> {
  requireTaskActivity(input)
  const row = await loadTaskRow(input.taskId)
  requireTaskRowIdentity(row, input)
  if (terminalStatus(row.status)) {
    return {
      kind: 'already_terminal',
      result: await terminalResultFromRow(row),
    }
  }
  if (row.status !== TASK_STATUS.QUEUED) {
    return failNonRetryable('TASK_INITIAL_STATUS_INVALID', row.id, row.status)
  }
  if (row.attempt !== 0) {
    return failNonRetryable('TASK_INITIAL_ATTEMPT_NOT_DRAINED', row.id, row.attempt)
  }
  const definition = getTaskDefinition(input.taskType)
  return {
    kind: 'ready',
    policy: {
      maxAttempts: definition.maxAttempts,
      retryBackoffBaseMs: TASK_RETRY_BACKOFF_BASE_MS,
      executionDeadlineMs: definition.executionDeadlineMs,
    },
  }
}

export async function resolveTaskSchedulerAdmission(
  input: TaskWorkflowInput,
): Promise<TaskSchedulerAdmission> {
  requireTaskWorkflowIdentity(input)
  requireSchedulerActivity(activityInfo().workflowExecution?.workflowId ?? '', input.userId)
  const [row, slotLimits] = await Promise.all([
    loadTaskRow(input.taskId),
    getUserWorkflowConcurrencyConfig(input.userId),
  ])
  requireTaskRowIdentity(row, input)
  const schedulerClass = getTaskDefinition(input.taskType).schedulerClass
  if (terminalStatus(row.status)) {
    return {
      kind: 'already_terminal',
      schedulerClass,
      slotLimits,
      result: await terminalResultFromRow(row),
    }
  }
  if (row.status !== TASK_STATUS.QUEUED || row.attempt !== 0) {
    return failNonRetryable(
      'TASK_SCHEDULER_ADMISSION_STATE_INVALID',
      row.id,
      row.status,
      row.attempt,
    )
  }
  return { kind: 'schedule', schedulerClass, slotLimits }
}

/**
 * Durably owns one business-attempt number before the long handler Activity
 * is scheduled. Temporal retries of the handler can then never advance the
 * Task row, and a worker outage before handler start cannot leave Workflow
 * state one attempt ahead of the business projection.
 */
export async function beginTaskAttempt(input: BeginTaskAttemptInput): Promise<void> {
  requireTaskActivity(input)
  const attempt = requirePositiveInt(input.attempt, 'TASK_ATTEMPT_INVALID')
  const expectedAttemptId = `${input.workflowId}:attempt:${String(attempt)}`
  if (input.attemptId !== expectedAttemptId) {
    return failNonRetryable('TASK_ATTEMPT_ID_MISMATCH', input.attemptId, expectedAttemptId)
  }
  const row = await loadTaskRow(input.taskId)
  requireTaskRowIdentity(row, input)
  if (terminalStatus(row.status)) {
    return failNonRetryable('TASK_ATTEMPT_CLAIMED_AFTER_TERMINAL', row.id, row.status)
  }
  await claimBusinessAttempt(input)
}

export async function reportTaskRetry(input: ReportTaskRetryInput): Promise<void> {
  requireTaskActivity(input)
  const attempt = requirePositiveInt(input.attempt, 'TASK_ATTEMPT_INVALID')
  const row = await loadTaskRow(input.taskId)
  const data = requireTaskRowIdentity(row, input)
  if (terminalStatus(row.status)) return
  if (row.status !== TASK_STATUS.PROCESSING || row.attempt !== attempt) {
    return failNonRetryable(
      'TASK_RETRY_PROJECTION_DIVERGED',
      row.id,
      attempt,
      row.status,
      row.attempt,
    )
  }
  await projectTaskProgress({
    data,
    attempt,
    progress: row.progress,
    payload: { stage: 'retrying' },
  })
}

export async function runTaskAttempt(input: RunTaskAttemptInput): Promise<RunTaskAttemptResult> {
  requireTaskActivity(input)
  const attempt = requirePositiveInt(input.attempt, 'TASK_ATTEMPT_INVALID')
  const expectedAttemptId = `${input.workflowId}:attempt:${String(attempt)}`
  if (input.attemptId !== expectedAttemptId) {
    return failNonRetryable('TASK_ATTEMPT_ID_MISMATCH', input.attemptId, expectedAttemptId)
  }
  const definition = getTaskDefinition(input.taskType)
  if (input.executionDeadlineMs !== definition.executionDeadlineMs) {
    return failNonRetryable(
      'TASK_EXECUTION_DEADLINE_DIVERGED',
      input.taskId,
      input.executionDeadlineMs,
      definition.executionDeadlineMs,
    )
  }
  const info = activityInfo()
  const priorHeartbeat: unknown = info.heartbeatDetails
  assertHeartbeatIdentity(priorHeartbeat, input)

  const row = await loadTaskRow(input.taskId)
  const data = requireTaskRowIdentity(row, input)
  if (terminalStatus(row.status)) {
    if (row.status === TASK_STATUS.CANCELED) {
      return { kind: 'canceled', reason: 'TASK_CANCELLED' }
    }
    return failNonRetryable('TASK_ATTEMPT_STARTED_AFTER_TERMINAL', row.id, row.status)
  }
  if (row.status !== TASK_STATUS.PROCESSING || row.attempt !== attempt) {
    return failNonRetryable(
      'TASK_ATTEMPT_NOT_DURABLY_CLAIMED',
      row.id,
      attempt,
      row.status,
      row.attempt,
    )
  }

  const inputFingerprint = await loadTaskExecutionFingerprint(input.taskId)
  const completedCheckpoint = await loadTaskHandlerCheckpoint({
    taskId: input.taskId,
    inputFingerprint,
  })
  if (completedCheckpoint) {
    return {
      kind: 'completed',
      executionCheckpointId: completedCheckpoint.id,
    }
  }
  const failedCheckpoint = await loadAttemptFailureCheckpoint({
    taskId: input.taskId,
    inputFingerprint,
    workflowId: input.workflowId,
    attemptId: input.attemptId,
    attempt,
  })
  if (failedCheckpoint) {
    return { kind: 'failed', failure: failedCheckpoint.failure }
  }

  const activityContext = Context.current()
  const pulse = (): void => {
    heartbeat(heartbeatPayload(input))
  }
  pulse()
  const heartbeatTimer = setInterval(() => {
    try {
      pulse()
    } catch (error) {
      logger.warn({
        action: 'temporal.task.heartbeat.failed',
        message: 'Temporal Task Activity heartbeat failed',
        taskId: input.taskId,
        details: { businessAttempt: attempt, activityAttempt: info.attempt },
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) },
      })
    }
  }, TASK_ACTIVITY_HEARTBEAT_INTERVAL_MS)
  heartbeatTimer.unref()

  const executionContext: TaskExecutionContext = {
    data,
    attempt,
    signal: activityContext.cancellationSignal,
    executionDeadlineMs: input.executionDeadlineMs,
    heartbeat: pulse,
  }

  try {
    let executed: {
      result: TaskExecutionResult
      textUsage: TextUsageEntry[]
    }
    try {
      executed = await withLogContext(
        {
          taskId: input.taskId,
          taskAttempt: attempt,
          requestId: data.trace?.requestId ?? undefined,
          module: 'temporal.task',
          projectId: data.projectId,
          userId: data.userId,
        },
        async () =>
          await withTextUsageCollection(async () => await executeTaskHandler(executionContext)),
      )
    } catch (error) {
      if (activityContext.cancellationSignal.aborted) {
        throw new CancelledFailure(
          'Task Activity cancellation acknowledged',
          [],
          error instanceof Error
            ? error
            : new Error('Task Activity failed with a non-Error value', { cause: error }),
        )
      }
      if (error instanceof TaskTerminatedError) {
        const current = await loadTaskRow(input.taskId)
        if (current.status === TASK_STATUS.CANCELED) {
          return { kind: 'canceled', reason: error.message }
        }
      }
      const failureRecord = normalizeAnyError(error, {
        context: { system: 'temporal', phase: 'task-attempt' },
      })
      logger.error({
        action: 'task.attempt.failed',
        message: 'task attempt returned a classified failure',
        taskId: input.taskId,
        errorCode: failureRecord.interpretation.code,
        details: { attempt },
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
      })
      const failure: TaskAttemptFailure = {
        failure: failureRecord,
        retryDisposition: shouldRetryTaskFailure({
          failure: failureRecord,
        })
          ? 'retryable'
          : 'final',
      }
      const checkpoint = await saveAttemptFailureCheckpoint({
        taskId: input.taskId,
        inputFingerprint,
        checkpoint: {
          version: 1,
          workflowId: input.workflowId,
          attemptId: input.attemptId,
          attempt,
          failure,
        },
      })
      return { kind: 'failed', failure: checkpoint.failure }
    }

    // Checkpoint persistence is infrastructure, not a handler outcome. If the
    // Activity completion is lost or this write races another retry, Temporal
    // must retry the same Activity attempt and load the winning checkpoint;
    // it must never consume a new business attempt as a synthetic failure.
    const checkpoint = await saveTaskHandlerCheckpoint({
      taskId: input.taskId,
      inputFingerprint,
      output: {
        result: executed.result ?? null,
        textUsage: executed.textUsage,
      },
    })
    return {
      kind: 'completed',
      executionCheckpointId: checkpoint.id,
    }
  } finally {
    clearInterval(heartbeatTimer)
  }
}

export async function commitTaskTerminal(
  input: CommitTaskTerminalInput,
): Promise<TaskTerminalReceipt> {
  const row = await loadTaskRow(input.taskId)
  const canonicalData = buildTaskExecutionData(row)
  const canonicalIdentity: TaskIdentity = {
    workflowId: input.workflowId,
    taskId: input.taskId,
    userId: row.userId,
    taskType: canonicalData.type,
  }
  const currentWorkflowId = activityInfo().workflowExecution?.workflowId
  if (currentWorkflowId === input.workflowId) {
    requireTaskActivity(canonicalIdentity)
  } else if (
    input.kind === 'canceled' &&
    currentWorkflowId === buildUserTaskSchedulerWorkflowId(row.userId) &&
    ((row.status === TASK_STATUS.QUEUED && row.attempt === 0) ||
      terminalStatus(row.status) !== null)
  ) {
    requireSchedulerActivity(currentWorkflowId, row.userId)
  } else {
    return failNonRetryable(
      'TASK_TERMINAL_ACTIVITY_OWNER_MISMATCH',
      currentWorkflowId ?? null,
      input.workflowId,
    )
  }
  requireTaskRowIdentity(row, canonicalIdentity)

  if (input.kind === 'completed') {
    requirePositiveInt(input.attempt, 'TASK_ATTEMPT_INVALID')
    requireNonEmpty(input.executionCheckpointId, 'TASK_EXECUTION_CHECKPOINT_ID_INVALID')
    const result = await commitBusinessTaskTerminal({
      kind: 'completed',
      taskId: input.taskId,
      fence: { kind: 'attempt', attempt: input.attempt },
      executionCheckpointId: input.executionCheckpointId,
      eventPayload: { stage: 'completed', runtime: 'temporal' },
    })
    return await terminalReceiptFromCommit(input.taskId, 'completed', result)
  }
  if (input.kind === 'failed') {
    requirePositiveInt(input.attempt, 'TASK_ATTEMPT_INVALID')
    const failure = parseFailureRecord(input.failure)
    if (!failure) failNonRetryable('TASK_TERMINAL_FAILURE_INVALID')
    const result = await commitBusinessTaskTerminal({
      kind: 'failed',
      taskId: input.taskId,
      fence: { kind: 'attempt', attempt: input.attempt },
      source: input.source,
      failure,
      eventPayload: { stage: 'failed', runtime: 'temporal' },
    })
    return await terminalReceiptFromCommit(input.taskId, 'failed', result)
  }
  requireNonEmpty(input.reason, 'TASK_CANCEL_REASON_INVALID')
  const inputFingerprint = await loadTaskExecutionFingerprint(input.taskId)
  const completedCheckpoint = await loadTaskHandlerCheckpoint({
    taskId: input.taskId,
    inputFingerprint,
  })
  if (completedCheckpoint) {
    const result = await commitBusinessTaskTerminal({
      kind: 'completed',
      taskId: input.taskId,
      fence: { kind: 'active' },
      executionCheckpointId: completedCheckpoint.id,
      eventPayload: {
        stage: 'completed',
        runtime: 'temporal',
        recoveredFromLateCancellation: true,
      },
    })
    return await terminalReceiptFromCommit(input.taskId, 'completed', result)
  }
  const result = await commitBusinessTaskTerminal({
    kind: 'canceled',
    taskId: input.taskId,
    fence: { kind: 'active' },
    source: input.source,
    reason: input.reason,
    eventPayload: { stage: 'canceled', runtime: 'temporal' },
  })
  const receipt = await terminalReceiptFromCommit(input.taskId, 'canceled', result)
  return receipt
}

export async function commitTaskWorkflowFailure(
  input: CommitTaskWorkflowFailureInput,
): Promise<TaskWorkflowResult> {
  requireNonEmpty(input.enqueueId, 'TASK_SCHEDULER_ENQUEUE_ID_INVALID')
  requireTaskWorkflowIdentity(input.task)
  if (input.owner === 'scheduler') {
    requireSchedulerActivity(input.schedulerWorkflowId, input.task.userId)
  } else if (input.owner === 'task_workflow') {
    requireCurrentWorkflow(input.task.workflowId, 'TASK_WORKFLOW_FAILURE_ACTIVITY_OWNER_MISMATCH')
  } else {
    return failNonRetryable('TASK_WORKFLOW_FAILURE_OWNER_INVALID')
  }
  const row = await loadTaskRow(input.task.taskId)
  requireTaskRowIdentity(row, input.task)
  if (terminalStatus(row.status)) return await terminalResultFromRow(row)

  const inputFingerprint = await loadTaskExecutionFingerprint(input.task.taskId)
  const completedCheckpoint = await loadTaskHandlerCheckpoint({
    taskId: input.task.taskId,
    inputFingerprint,
  })
  const commit = completedCheckpoint
    ? await commitBusinessTaskTerminal({
        kind: 'completed',
        taskId: input.task.taskId,
        fence: { kind: 'active' },
        executionCheckpointId: completedCheckpoint.id,
        eventPayload: {
          stage: 'completed',
          runtime: 'temporal',
          recoveredFromWorkflowFailure: true,
        },
      })
    : await commitBusinessTaskTerminal({
        kind: 'failed',
        taskId: input.task.taskId,
        fence: { kind: 'active' },
        source: 'workflow',
        failure: createFailureRecord(
          'WORKER_EXECUTION_ERROR',
          'Task Workflow failed before returning a terminal result',
          {
            context: { system: 'temporal', phase: 'task-workflow' },
            details: {
              schedulerWorkflowId: input.schedulerWorkflowId,
              enqueueId: input.enqueueId,
            },
          },
        ),
        eventPayload: {
          stage: 'failed',
          runtime: 'temporal',
          workflowFailure: true,
        },
      })
  if (!commit.applied && commit.reason !== 'already_terminal') {
    return failNonRetryable(
      'TASK_WORKFLOW_FAILURE_COMMIT_REJECTED',
      input.task.taskId,
      commit.reason,
    )
  }
  try {
    await publishPersistedTaskEventById(commit.terminalEventId, input.task.taskId)
  } catch (error) {
    Context.current().log.warn(
      'task workflow-failure terminal event live publication failed; durable replay remains authoritative',
      {
        taskId: input.task.taskId,
        eventId: commit.terminalEventId,
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
  return await terminalResultFromRow(await loadTaskRow(input.task.taskId))
}

/**
 * A committed Task terminal releases provider capacity before any Agent
 * continuation notification is attempted. The stable Update ID makes an
 * Activity ACK loss an exact replay of the same release.
 */
export async function releaseTaskCapacity(input: ReleaseTaskCapacityInput): Promise<void> {
  requireNonEmpty(input.schedulerWorkflowId, 'TASK_SCHEDULER_WORKFLOW_ID_INVALID')
  requireNonEmpty(input.taskWorkflowId, 'TASK_WORKFLOW_ID_INVALID')
  requireNonEmpty(input.taskId, 'TASK_ID_INVALID')
  requirePositiveInt(input.terminalEventId, 'TASK_CAPACITY_RELEASE_EVENT_ID_INVALID')
  requireCurrentWorkflow(
    input.taskWorkflowId,
    'TASK_CAPACITY_RELEASE_ACTIVITY_WORKFLOW_ID_MISMATCH',
  )

  const row = await loadTaskRow(input.taskId)
  const canonicalData = buildTaskExecutionData(row)
  const canonicalIdentity: TaskIdentity = {
    workflowId: input.taskWorkflowId,
    taskId: input.taskId,
    userId: row.userId,
    taskType: canonicalData.type,
  }
  requireTaskWorkflowIdentity(canonicalIdentity)
  requireTaskRowIdentity(row, canonicalIdentity)
  const expectedSchedulerWorkflowId = buildUserTaskSchedulerWorkflowId(row.userId)
  if (input.schedulerWorkflowId !== expectedSchedulerWorkflowId) {
    return failNonRetryable(
      'TASK_SCHEDULER_WORKFLOW_ID_MISMATCH',
      input.schedulerWorkflowId,
      expectedSchedulerWorkflowId,
    )
  }
  const status = terminalStatus(row.status)
  if (!status) {
    return failNonRetryable('TASK_CAPACITY_RELEASE_BEFORE_TERMINAL', input.taskId, row.status)
  }
  if (status !== input.status) {
    return failNonRetryable(
      'TASK_CAPACITY_RELEASE_STATUS_DIVERGED',
      input.taskId,
      input.status,
      status,
    )
  }
  const terminalResult = await terminalResultFromRow(row)
  if (terminalResult.terminal.terminalEventId !== input.terminalEventId) {
    return failNonRetryable(
      'TASK_CAPACITY_RELEASE_EVENT_DIVERGED',
      input.taskId,
      input.terminalEventId,
      terminalResult.terminal.terminalEventId,
    )
  }

  const release: SchedulerCapacityRelease = {
    taskWorkflowId: input.taskWorkflowId,
    taskId: input.taskId,
    terminalEventId: input.terminalEventId,
    status: input.status,
  }
  const client = await getTemporalClient()
  const scheduler = client.workflow.getHandle(input.schedulerWorkflowId)
  const view = await scheduler.executeUpdate<UserTaskSchedulerView, [SchedulerCapacityRelease]>(
    USER_TASK_SCHEDULER_UPDATE_NAME.RELEASE_CAPACITY,
    {
      args: [release],
      updateId: ['task-capacity-release', input.taskWorkflowId, String(input.terminalEventId)].join(
        ':',
      ),
    },
  )
  if (
    !view ||
    typeof view !== 'object' ||
    view.workflowId !== input.schedulerWorkflowId ||
    view.capacityActiveTaskWorkflowIds.includes(input.taskWorkflowId)
  ) {
    return failNonRetryable(
      'TASK_CAPACITY_RELEASE_ACK_DIVERGED',
      input.taskWorkflowId,
      input.terminalEventId,
    )
  }
}

/**
 * Compensate provider jobs only after the Workflow has released Scheduler
 * capacity and completed every required FollowUpBatch handoff. The Task
 * terminal event is revalidated before reading the ledger, so this Activity
 * cannot cancel a completed winner or an unrelated replay.
 */
export async function cancelTaskProviderJobs(input: CancelTaskProviderJobsInput): Promise<void> {
  requireNonEmpty(input.workflowId, 'TASK_WORKFLOW_ID_INVALID')
  requireNonEmpty(input.taskId, 'TASK_ID_INVALID')
  requireNonEmpty(input.userId, 'TASK_USER_ID_INVALID')
  requirePositiveInt(input.terminalEventId, 'TASK_PROVIDER_CANCEL_TERMINAL_EVENT_ID_INVALID')
  requireCurrentWorkflow(input.workflowId, 'TASK_PROVIDER_CANCEL_ACTIVITY_WORKFLOW_ID_MISMATCH')

  const row = await loadTaskRow(input.taskId)
  const canonicalData = buildTaskExecutionData(row)
  const canonicalIdentity: TaskIdentity = {
    workflowId: input.workflowId,
    taskId: input.taskId,
    userId: input.userId,
    taskType: canonicalData.type,
  }
  requireTaskWorkflowIdentity(canonicalIdentity)
  requireTaskRowIdentity(row, canonicalIdentity)
  if (row.status !== TASK_STATUS.CANCELED) {
    return failNonRetryable('TASK_PROVIDER_CANCEL_STATUS_DIVERGED', input.taskId, row.status)
  }
  const terminalResult = await terminalResultFromRow(row)
  if (
    terminalResult.status !== 'canceled' ||
    terminalResult.terminal.terminalEventId !== input.terminalEventId
  ) {
    return failNonRetryable(
      'TASK_PROVIDER_CANCEL_TERMINAL_DIVERGED',
      input.taskId,
      input.terminalEventId,
      terminalResult.status,
      terminalResult.terminal.terminalEventId,
    )
  }
  // queued cancellation is owned directly by Scheduler and never creates this
  // TaskWorkflow. Keep a defensive no-op for exact terminal replays.
  if (row.attempt === 0) return

  await cancelAcceptedTaskProviderJobsAfterTerminal({
    taskId: input.taskId,
    userId: input.userId,
  })
}

/**
 * Notify exactly one ready Batch after provider capacity has been released.
 * The Batch remains the durable retry authority. The Web process owns the
 * AssistantRuntime singleton; this Activity crosses that process boundary
 * with only the stable Batch identity, so an ACK loss replays the same source.
 */
export async function notifyTaskFollowUp(input: NotifyTaskFollowUpInput): Promise<void> {
  requireNonEmpty(input.workflowId, 'TASK_WORKFLOW_ID_INVALID')
  requireNonEmpty(input.taskId, 'TASK_ID_INVALID')
  requireNonEmpty(input.batchId, 'TASK_FOLLOW_UP_BATCH_ID_MISSING')
  if (!input.terminal.readyFollowUpBatchIds.includes(input.batchId)) {
    return failNonRetryable('TASK_FOLLOW_UP_BATCH_RECEIPT_DIVERGED', input.batchId)
  }
  try {
    await requestAssistantRuntimeTaskFollowUp(input.batchId)
  } catch (error) {
    const failure = normalizeAnyError(error, {
      context: { system: 'runtime', phase: 'task-follow-up-delivery' },
      operation: EXTERNAL_OPERATION.ASSISTANT_FOLLOW_UP_DELIVERY,
      details: { batchId: input.batchId },
    })
    const encoded = encodeTemporalFailure(failure)
    throw ApplicationFailure.retryable(encoded.message, encoded.type, ...encoded.details)
  }
}
