import { createHash } from 'node:crypto'
import {
  WithStartWorkflowOperation,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowUpdateFailedError,
  type WorkflowClient,
} from '@temporalio/client'
import { isTaskType } from '@/lib/task/types'
import { getTemporalClient } from './client'
import { getTemporalRuntimeConfig } from './config'
import { buildTaskWorkflowId, buildUserTaskSchedulerWorkflowId } from './identity'
import {
  TASK_WORKFLOW_UPDATE_NAME,
  USER_TASK_SCHEDULER_UPDATE_NAME,
  type PersistedTaskReference,
  type ScheduledTaskReceipt,
  type ScheduledTaskRequest,
  type SchedulerTaskCancelDecision,
  type SchedulerTaskCancelRequest,
  type TaskCancelRequest,
  type TaskSchedulerClass,
  type TaskTerminalReceipt,
  type TaskWorkflowInput,
  type TaskWorkflowResult,
  type TaskWorkflowView,
  type UserTaskSchedulerView,
  type UserTaskSchedulerWorkflowInput,
} from './task/contracts'
import { TEMPORAL_WORKFLOW } from './workflow-registry'

const SCHEDULER_BOOTSTRAP_SLOT_LIMITS = {
  analysis: 1,
  image: 1,
  video: 1,
} as const

type TaskWorkflow = (input: TaskWorkflowInput) => Promise<TaskWorkflowResult>

type UserTaskSchedulerWorkflow = (
  input: UserTaskSchedulerWorkflowInput,
) => Promise<UserTaskSchedulerView>

export class TemporalTaskCommandUnconfirmedError extends Error {
  readonly code = 'TEMPORAL_TASK_COMMAND_UNCONFIRMED'
  override readonly cause: unknown

  constructor(
    readonly commandKind: 'schedule' | 'cancel',
    readonly commandId: string,
    readonly updateId: string,
    cause: unknown,
  ) {
    super(`Temporal Task ${commandKind} acknowledgement is unconfirmed: ${commandId}`)
    this.name = 'TemporalTaskCommandUnconfirmedError'
    this.cause = cause
  }
}

function requireIdentity(value: string, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized !== value) throw new Error(code)
  return normalized
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function taskWorkflowInput(reference: PersistedTaskReference): TaskWorkflowInput {
  const taskId = requireIdentity(reference.taskId, 'TASK_ID_INVALID')
  const userId = requireIdentity(reference.userId, 'TASK_USER_ID_INVALID')
  if (!isTaskType(reference.taskType)) {
    throw new Error(`TASK_TYPE_INVALID:${String(reference.taskType)}`)
  }
  return {
    workflowId: buildTaskWorkflowId(taskId),
    schedulerWorkflowId: buildUserTaskSchedulerWorkflowId(userId),
    taskId,
    userId,
    taskType: reference.taskType,
  }
}

function scheduleRequest(reference: PersistedTaskReference): {
  request: ScheduledTaskRequest
  updateId: string
} {
  const task = taskWorkflowInput(reference)
  const enqueueId = `task-enqueue:v1:${hash(task.taskId)}`
  return {
    request: { enqueueId, task },
    updateId: [
      'task-enqueue-update:v1',
      hash(enqueueId),
      hash(
        JSON.stringify([
          task.workflowId,
          task.schedulerWorkflowId,
          task.taskId,
          task.userId,
          task.taskType,
        ]),
      ),
    ].join(':'),
  }
}

function cancelRequest(input: { reference: PersistedTaskReference; reason: string }): {
  taskId: string
  workflowId: string
  schedulerWorkflowId: string
  schedulerRequest: SchedulerTaskCancelRequest
  request: TaskCancelRequest
  updateId: string
} {
  const scheduledTask = scheduleRequest(input.reference).request
  const taskId = scheduledTask.task.taskId
  const reason = requireIdentity(input.reason, 'TASK_CANCEL_REASON_INVALID')
  const requestId = `task-cancel:v1:${hash(taskId)}`
  return {
    taskId,
    workflowId: scheduledTask.task.workflowId,
    schedulerWorkflowId: scheduledTask.task.schedulerWorkflowId,
    schedulerRequest: {
      scheduledTask,
      cancellation: { requestId, reason },
    },
    request: { requestId, reason },
    updateId: ['task-cancel-update:v1', hash(requestId), hash(reason)].join(':'),
  }
}

export interface TemporalTaskCancelReceipt {
  taskId: string
  status: TaskWorkflowView['status']
  cancelRequested: boolean
}

function parseSchedulerCancelDecision(value: unknown): SchedulerTaskCancelDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TASK_SCHEDULER_CANCEL_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (record.kind === 'forward_to_task_workflow') {
    return { kind: 'forward_to_task_workflow' }
  }
  if (
    record.kind === 'terminal' &&
    (record.status === 'completed' || record.status === 'failed' || record.status === 'canceled')
  ) {
    return { kind: 'terminal', status: record.status }
  }
  throw new Error('TASK_SCHEDULER_CANCEL_RECEIPT_DIVERGED')
}

function isSchedulerClass(value: unknown): value is TaskSchedulerClass {
  return value === 'analysis' || value === 'image' || value === 'video'
}

function isScheduledTaskState(value: unknown): value is ScheduledTaskReceipt['state'] {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'notification_pending' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'canceled'
  )
}

function parseScheduledTaskReceipt(
  value: unknown,
  expected: ScheduledTaskRequest,
): ScheduledTaskReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TASK_SCHEDULE_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (
    record.enqueueId !== expected.enqueueId ||
    record.taskWorkflowId !== expected.task.workflowId ||
    (record.schedulerClass !== null && !isSchedulerClass(record.schedulerClass)) ||
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence as number) <= 0 ||
    !isScheduledTaskState(record.state)
  ) {
    throw new Error('TASK_SCHEDULE_RECEIPT_DIVERGED')
  }
  return {
    enqueueId: expected.enqueueId,
    taskWorkflowId: expected.task.workflowId,
    schedulerClass: record.schedulerClass,
    sequence: record.sequence as number,
    state: record.state,
  }
}

function parseTerminalReceipt(value: unknown, taskId: string): TaskTerminalReceipt | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TASK_TERMINAL_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  const status = record.status
  const readyFollowUpBatchIds = record.readyFollowUpBatchIds
  if (
    record.taskId !== taskId ||
    (status !== 'completed' && status !== 'failed' && status !== 'canceled') ||
    !Number.isSafeInteger(record.terminalEventId) ||
    (record.terminalEventId as number) <= 0 ||
    !Array.isArray(readyFollowUpBatchIds) ||
    readyFollowUpBatchIds.length > 64 ||
    new Set(readyFollowUpBatchIds).size !== readyFollowUpBatchIds.length ||
    readyFollowUpBatchIds.some(
      (batchId) =>
        typeof batchId !== 'string' || batchId.trim() !== batchId || batchId.length === 0,
    )
  ) {
    throw new Error('TASK_TERMINAL_RECEIPT_DIVERGED')
  }
  return {
    taskId,
    status,
    terminalEventId: record.terminalEventId as number,
    readyFollowUpBatchIds: readyFollowUpBatchIds as string[],
  }
}

function parseTaskWorkflowView(
  value: unknown,
  expected: { workflowId: string; taskId: string },
): TaskWorkflowView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TASK_WORKFLOW_VIEW_INVALID')
  }
  const record = value as Record<string, unknown>
  const status = record.status
  const validStatus =
    status === 'initializing' ||
    status === 'running' ||
    status === 'retry_wait' ||
    status === 'cancelling' ||
    status === 'notifying' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'canceled'
  if (
    record.workflowId !== expected.workflowId ||
    record.taskId !== expected.taskId ||
    !validStatus ||
    !Number.isSafeInteger(record.attempt) ||
    (record.attempt as number) < 0 ||
    (record.maxAttempts !== null &&
      (!Number.isSafeInteger(record.maxAttempts) || (record.maxAttempts as number) <= 0)) ||
    typeof record.cancelRequested !== 'boolean' ||
    typeof record.capacityReleased !== 'boolean'
  ) {
    throw new Error('TASK_WORKFLOW_VIEW_DIVERGED')
  }
  const terminal = parseTerminalReceipt(record.terminal, expected.taskId)
  if (terminal && status !== 'notifying' && status !== terminal.status) {
    throw new Error('TASK_WORKFLOW_VIEW_TERMINAL_DIVERGED')
  }
  return {
    workflowId: expected.workflowId,
    taskId: expected.taskId,
    status,
    attempt: record.attempt as number,
    maxAttempts: record.maxAttempts as number | null,
    cancelRequested: record.cancelRequested,
    capacityReleased: record.capacityReleased,
    terminal,
  }
}

export class TemporalTaskClient {
  constructor(
    private readonly workflowClient: WorkflowClient,
    private readonly taskQueue: string,
  ) {
    requireIdentity(taskQueue, 'TEMPORAL_TASK_QUEUE_INVALID')
  }

  async schedule(reference: PersistedTaskReference): Promise<ScheduledTaskReceipt> {
    const { request, updateId } = scheduleRequest(reference)
    const schedulerWorkflowId = request.task.schedulerWorkflowId
    const startOperation = new WithStartWorkflowOperation<UserTaskSchedulerWorkflow>(
      TEMPORAL_WORKFLOW.USER_TASK_SCHEDULER.type,
      {
        workflowId: schedulerWorkflowId,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        taskQueue: this.taskQueue,
        args: [
          {
            workflowId: schedulerWorkflowId,
            userId: request.task.userId,
            slotLimits: SCHEDULER_BOOTSTRAP_SLOT_LIMITS,
          },
        ],
      },
    )
    let value: unknown
    try {
      value = await this.workflowClient.executeUpdateWithStart<
        UserTaskSchedulerWorkflow,
        unknown,
        [ScheduledTaskRequest]
      >(USER_TASK_SCHEDULER_UPDATE_NAME.ENQUEUE, {
        updateId,
        args: [request],
        startWorkflowOperation: startOperation,
      })
    } catch (error) {
      if (error instanceof WorkflowUpdateFailedError) throw error
      throw new TemporalTaskCommandUnconfirmedError('schedule', request.enqueueId, updateId, error)
    }
    return parseScheduledTaskReceipt(value, request)
  }

  async cancel(input: {
    reference: PersistedTaskReference
    reason: string
  }): Promise<TemporalTaskCancelReceipt> {
    const command = cancelRequest(input)
    const startOperation = new WithStartWorkflowOperation<UserTaskSchedulerWorkflow>(
      TEMPORAL_WORKFLOW.USER_TASK_SCHEDULER.type,
      {
        workflowId: command.schedulerWorkflowId,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        taskQueue: this.taskQueue,
        args: [
          {
            workflowId: command.schedulerWorkflowId,
            userId: command.schedulerRequest.scheduledTask.task.userId,
            slotLimits: SCHEDULER_BOOTSTRAP_SLOT_LIMITS,
          },
        ],
      },
    )
    let value: unknown
    try {
      value = await this.workflowClient.executeUpdateWithStart<
        UserTaskSchedulerWorkflow,
        unknown,
        [SchedulerTaskCancelRequest]
      >(USER_TASK_SCHEDULER_UPDATE_NAME.CANCEL_QUEUED, {
        updateId: `${command.updateId}:scheduler`,
        args: [command.schedulerRequest],
        startWorkflowOperation: startOperation,
      })
    } catch (error) {
      if (error instanceof WorkflowUpdateFailedError) throw error
      throw new TemporalTaskCommandUnconfirmedError(
        'cancel',
        command.request.requestId,
        command.updateId,
        error,
      )
    }
    const decision = parseSchedulerCancelDecision(value)
    if (decision.kind === 'terminal') {
      return {
        taskId: command.taskId,
        status: decision.status,
        cancelRequested: decision.status === 'canceled',
      }
    }
    try {
      value = await this.workflowClient
        .getHandle<TaskWorkflow>(command.workflowId)
        .executeUpdate<unknown, [TaskCancelRequest]>(TASK_WORKFLOW_UPDATE_NAME.CANCEL, {
          updateId: command.updateId,
          args: [command.request],
        })
    } catch (error) {
      if (error instanceof WorkflowUpdateFailedError) throw error
      throw new TemporalTaskCommandUnconfirmedError(
        'cancel',
        command.request.requestId,
        command.updateId,
        error,
      )
    }
    const view = parseTaskWorkflowView(value, command)
    return {
      taskId: view.taskId,
      status: view.status,
      cancelRequested: view.cancelRequested,
    }
  }
}

async function productionTaskClient(): Promise<TemporalTaskClient> {
  const [client, config] = await Promise.all([
    getTemporalClient(),
    Promise.resolve(getTemporalRuntimeConfig()),
  ])
  return new TemporalTaskClient(client.workflow, config.taskQueue)
}

export async function schedulePersistedTask(
  reference: PersistedTaskReference,
): Promise<ScheduledTaskReceipt> {
  return await (await productionTaskClient()).schedule(reference)
}

export async function cancelTemporalTask(input: {
  reference: PersistedTaskReference
  reason: string
}): Promise<TemporalTaskCancelReceipt> {
  return await (await productionTaskClient()).cancel(input)
}
