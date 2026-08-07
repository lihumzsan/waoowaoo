import type { FailureRecord } from '@/lib/errors/failure'
import type { TaskSchedulerClass } from '@/lib/task/definition'
import type { TaskType } from '@/lib/task/types'
import type { WorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'

export type { TaskSchedulerClass } from '@/lib/task/definition'

export const TASK_WORKFLOW_UPDATE_NAME = {
  CANCEL: 'task.cancel',
} as const

export const USER_TASK_SCHEDULER_UPDATE_NAME = {
  ENQUEUE: 'user-task-scheduler.enqueue',
  CANCEL_QUEUED: 'user-task-scheduler.cancel-queued',
  RELEASE_CAPACITY: 'user-task-scheduler.release-capacity',
} as const

export type TaskWorkflowTerminalStatus = 'completed' | 'failed' | 'canceled'

export interface TaskWorkflowInput {
  workflowId: string
  schedulerWorkflowId: string
  taskId: string
  userId: string
  taskType: TaskType
}

export interface PersistedTaskReference {
  taskId: string
  userId: string
  taskType: TaskType
}

export interface TaskWorkflowPolicySnapshot {
  maxAttempts: number
  retryBackoffBaseMs: number
  executionDeadlineMs: number | null
}

export interface TaskTerminalReceipt {
  taskId: string
  status: TaskWorkflowTerminalStatus
  terminalEventId: number
  readyFollowUpBatchIds: readonly string[]
}

export interface TaskWorkflowResult {
  taskId: string
  status: TaskWorkflowTerminalStatus
  attempts: number
  terminal: TaskTerminalReceipt
}

export interface InitializeTaskWorkflowInput {
  workflowId: string
  schedulerWorkflowId: string
  taskId: string
  userId: string
  taskType: TaskType
}

export type InitializeTaskWorkflowResult =
  | {
      kind: 'ready'
      policy: TaskWorkflowPolicySnapshot
    }
  | {
      kind: 'already_terminal'
      result: TaskWorkflowResult
    }

export interface RunTaskAttemptInput {
  workflowId: string
  taskId: string
  userId: string
  taskType: TaskType
  attempt: number
  attemptId: string
  executionDeadlineMs: number | null
}

export type BeginTaskAttemptInput = Omit<RunTaskAttemptInput, 'executionDeadlineMs'>

export interface ReportTaskRetryInput {
  workflowId: string
  taskId: string
  userId: string
  taskType: TaskType
  attempt: number
}

export interface TaskAttemptFailure {
  failure: FailureRecord
  retryDisposition: 'retryable' | 'final'
}

export type RunTaskAttemptResult =
  | {
      kind: 'completed'
      executionCheckpointId: string
    }
  | {
      kind: 'failed'
      failure: TaskAttemptFailure
    }
  | {
      kind: 'canceled'
      reason: string
    }

interface CommitTaskTerminalBase {
  workflowId: string
  taskId: string
}

export type CommitTaskTerminalInput =
  | (CommitTaskTerminalBase & {
      kind: 'completed'
      attempt: number
      executionCheckpointId: string
    })
  | (CommitTaskTerminalBase & {
      kind: 'failed'
      attempt: number
      failure: FailureRecord
      source: 'worker' | 'timeout'
    })
  | (CommitTaskTerminalBase & {
      kind: 'canceled'
      reason: string
      source: 'user' | 'system'
    })

export interface NotifyTaskFollowUpInput {
  workflowId: string
  taskId: string
  batchId: string
  terminal: TaskTerminalReceipt
}

export interface ReleaseTaskCapacityInput {
  schedulerWorkflowId: string
  taskWorkflowId: string
  taskId: string
  terminalEventId: number
  status: TaskWorkflowTerminalStatus
}

export interface CancelTaskProviderJobsInput {
  workflowId: string
  taskId: string
  userId: string
  terminalEventId: number
}

export interface TaskWorkflowActivities {
  initializeTaskWorkflow(input: InitializeTaskWorkflowInput): Promise<InitializeTaskWorkflowResult>
  beginTaskAttempt(input: BeginTaskAttemptInput): Promise<void>
  reportTaskRetry(input: ReportTaskRetryInput): Promise<void>
  runTaskAttempt(input: RunTaskAttemptInput): Promise<RunTaskAttemptResult>
  commitTaskTerminal(input: CommitTaskTerminalInput): Promise<TaskTerminalReceipt>
  commitTaskWorkflowFailure(input: CommitTaskWorkflowFailureInput): Promise<TaskWorkflowResult>
  releaseTaskCapacity(input: ReleaseTaskCapacityInput): Promise<void>
  cancelTaskProviderJobs(input: CancelTaskProviderJobsInput): Promise<void>
  notifyTaskFollowUp(input: NotifyTaskFollowUpInput): Promise<void>
}

export interface TaskCancelRequest {
  requestId: string
  reason: string
}

export type TaskWorkflowLifecycleStatus =
  | 'initializing'
  | 'running'
  | 'retry_wait'
  | 'cancelling'
  | 'notifying'
  | TaskWorkflowTerminalStatus

export interface TaskWorkflowView {
  workflowId: string
  taskId: string
  status: TaskWorkflowLifecycleStatus
  attempt: number
  maxAttempts: number | null
  cancelRequested: boolean
  capacityReleased: boolean
  terminal: TaskTerminalReceipt | null
}

export interface ScheduledTaskRequest {
  enqueueId: string
  task: TaskWorkflowInput
}

export type ScheduledTaskState =
  | 'queued'
  | 'running'
  | 'notification_pending'
  | TaskWorkflowTerminalStatus

export interface ScheduledTaskReceipt {
  enqueueId: string
  taskWorkflowId: string
  schedulerClass: TaskSchedulerClass | null
  sequence: number
  state: ScheduledTaskState
}

export interface SchedulerQueuedTask {
  request: ScheduledTaskRequest
  schedulerClass: TaskSchedulerClass | null
  sequence: number
}

export interface SchedulerEnqueueDedupeEntry {
  request: ScheduledTaskRequest
  schedulerClass: TaskSchedulerClass | null
  sequence: number
  state: ScheduledTaskState
}

export interface SchedulerCompletionSummary {
  taskWorkflowId: string
  status: TaskWorkflowTerminalStatus
  terminalEventId: number
  cancellation?: TaskCancelRequest
}

export interface SchedulerCapacityRelease {
  taskWorkflowId: string
  taskId: string
  terminalEventId: number
  status: TaskWorkflowTerminalStatus
}

export interface SchedulerTaskCancelRequest {
  scheduledTask: ScheduledTaskRequest
  cancellation: TaskCancelRequest
}

export type SchedulerTaskCancelDecision =
  | {
      kind: 'terminal'
      status: TaskWorkflowTerminalStatus
    }
  | {
      kind: 'forward_to_task_workflow'
    }

export interface SchedulerActiveTask {
  request: ScheduledTaskRequest
  schedulerClass: TaskSchedulerClass | null
  sequence: number
}

export interface UserTaskSchedulerContinuationState {
  queued: readonly SchedulerQueuedTask[]
  active: readonly SchedulerActiveTask[]
  recentEnqueues: readonly SchedulerEnqueueDedupeEntry[]
  recentCompletions: readonly SchedulerCompletionSummary[]
  nextSequence: number
  slotLimitsVersion: number
}

export interface UserTaskSchedulerWorkflowInput {
  workflowId: string
  userId: string
  slotLimits: WorkflowConcurrencyConfig
  continuation?: UserTaskSchedulerContinuationState
}

export type TaskSchedulerAdmission =
  | {
      kind: 'schedule'
      schedulerClass: TaskSchedulerClass | null
      slotLimits: WorkflowConcurrencyConfig
    }
  | {
      kind: 'already_terminal'
      schedulerClass: TaskSchedulerClass | null
      slotLimits: WorkflowConcurrencyConfig
      result: TaskWorkflowResult
    }

export interface CommitTaskWorkflowFailureInput {
  owner: 'scheduler' | 'task_workflow'
  schedulerWorkflowId: string
  enqueueId: string
  task: TaskWorkflowInput
}

export interface UserTaskSchedulerActivities {
  resolveTaskSchedulerAdmission(input: TaskWorkflowInput): Promise<TaskSchedulerAdmission>
  commitTaskWorkflowFailure(input: CommitTaskWorkflowFailureInput): Promise<TaskWorkflowResult>
  commitTaskTerminal(input: CommitTaskTerminalInput): Promise<TaskTerminalReceipt>
  notifyTaskFollowUp(input: NotifyTaskFollowUpInput): Promise<void>
}

export interface UserTaskSchedulerView {
  workflowId: string
  userId: string
  slotLimits: WorkflowConcurrencyConfig
  slotLimitsVersion: number
  queuedTaskWorkflowIds: readonly string[]
  capacityActiveTaskWorkflowIds: readonly string[]
  terminalNotificationPendingTaskWorkflowIds: readonly string[]
  activeByClass: WorkflowConcurrencyConfig
  drainingForContinueAsNew: boolean
}
