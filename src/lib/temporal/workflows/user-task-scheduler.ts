import {
  ApplicationFailure,
  ParentClosePolicy,
  Trigger,
  WorkflowIdReusePolicy,
  allHandlersFinished,
  condition,
  continueAsNew,
  defineUpdate,
  proxyActivities,
  setHandler,
  setWorkflowOptions,
  startChild,
  workflowInfo,
} from '@temporalio/workflow'
import type { WorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'
import { encodeTemporalFailure, temporalInvariantFailure } from '../failure'
import {
  USER_TASK_SCHEDULER_UPDATE_NAME,
  type ScheduledTaskReceipt,
  type ScheduledTaskRequest,
  type ScheduledTaskState,
  type SchedulerCapacityRelease,
  type SchedulerTaskCancelDecision,
  type SchedulerTaskCancelRequest,
  type SchedulerCompletionSummary,
  type SchedulerEnqueueDedupeEntry,
  type SchedulerQueuedTask,
  type TaskSchedulerClass,
  type TaskWorkflowResult,
  type UserTaskSchedulerActivities,
  type UserTaskSchedulerContinuationState,
  type UserTaskSchedulerView,
  type UserTaskSchedulerWorkflowInput,
} from '../task/contracts'
import { TEMPORAL_WORKFLOW } from '../workflow-registry'
import { taskWorkflow } from './task'

const RECENT_DEDUPE_LIMIT = 2_048

const enqueueTask = defineUpdate<ScheduledTaskReceipt, [ScheduledTaskRequest]>(
  USER_TASK_SCHEDULER_UPDATE_NAME.ENQUEUE,
)

const releaseCapacity = defineUpdate<UserTaskSchedulerView, [SchedulerCapacityRelease]>(
  USER_TASK_SCHEDULER_UPDATE_NAME.RELEASE_CAPACITY,
)

const cancelQueuedTask = defineUpdate<SchedulerTaskCancelDecision, [SchedulerTaskCancelRequest]>(
  USER_TASK_SCHEDULER_UPDATE_NAME.CANCEL_QUEUED,
)

interface ScheduledChild {
  request: ScheduledTaskRequest
  schedulerClass: TaskSchedulerClass | null
  sequence: number
}

interface PendingEnqueueValidation {
  request: ScheduledTaskRequest
  sequence: number
  result: Trigger<ScheduledTaskReceipt>
}

const schedulerActivities = proxyActivities<UserTaskSchedulerActivities>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
  },
})

function fail(code: string, ...details: unknown[]): never {
  const encoded = encodeTemporalFailure(temporalInvariantFailure(code, details))
  throw ApplicationFailure.nonRetryable(encoded.message, encoded.type, ...encoded.details)
}

function requireNonEmpty(value: string, code: string): void {
  if (!value || value !== value.trim()) fail(code)
}

function isSchedulerClass(value: unknown): value is TaskSchedulerClass {
  return value === 'analysis' || value === 'image' || value === 'video'
}

function isTerminalStatus(value: unknown): value is TaskWorkflowResult['status'] {
  return value === 'completed' || value === 'failed' || value === 'canceled'
}

function validateSlotLimits(limits: WorkflowConcurrencyConfig): void {
  if (!limits || typeof limits !== 'object') {
    fail('TASK_SCHEDULER_SLOT_LIMITS_INVALID')
  }
  for (const schedulerClass of ['analysis', 'image', 'video'] as const) {
    const limit = limits[schedulerClass]
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      fail('TASK_SCHEDULER_SLOT_LIMIT_INVALID', schedulerClass, limit)
    }
  }
}

function validateScheduledTask(
  schedulerWorkflowId: string,
  schedulerUserId: string,
  request: ScheduledTaskRequest,
): void {
  if (!request || typeof request !== 'object') {
    fail('TASK_SCHEDULER_ENQUEUE_INVALID')
  }
  requireNonEmpty(request.enqueueId, 'TASK_SCHEDULER_ENQUEUE_ID_INVALID')
  if (!request.task || typeof request.task !== 'object') {
    fail('TASK_SCHEDULER_TASK_INPUT_INVALID')
  }
  requireNonEmpty(request.task.workflowId, 'TASK_WORKFLOW_ID_INVALID')
  requireNonEmpty(request.task.schedulerWorkflowId, 'TASK_SCHEDULER_WORKFLOW_ID_INVALID')
  requireNonEmpty(request.task.taskId, 'TASK_ID_INVALID')
  requireNonEmpty(request.task.userId, 'TASK_USER_ID_INVALID')
  if (request.task.schedulerWorkflowId !== schedulerWorkflowId) {
    fail(
      'TASK_SCHEDULER_WORKFLOW_ID_MISMATCH',
      request.task.schedulerWorkflowId,
      schedulerWorkflowId,
    )
  }
  if (request.task.userId !== schedulerUserId) {
    fail('TASK_SCHEDULER_USER_MISMATCH', schedulerUserId, request.task.userId)
  }
}

function sameScheduledTask(left: ScheduledTaskRequest, right: ScheduledTaskRequest): boolean {
  return (
    left.enqueueId === right.enqueueId &&
    left.task.workflowId === right.task.workflowId &&
    left.task.schedulerWorkflowId === right.task.schedulerWorkflowId &&
    left.task.taskId === right.task.taskId &&
    left.task.userId === right.task.userId &&
    left.task.taskType === right.task.taskType
  )
}

function copySlotLimits(limits: WorkflowConcurrencyConfig): WorkflowConcurrencyConfig {
  return {
    analysis: limits.analysis,
    image: limits.image,
    video: limits.video,
  }
}

function capacityCounts(
  capacityActive: ReadonlyMap<string, ScheduledChild>,
): WorkflowConcurrencyConfig {
  const counts: WorkflowConcurrencyConfig = {
    analysis: 0,
    image: 0,
    video: 0,
  }
  for (const item of capacityActive.values()) {
    if (item.schedulerClass !== null) counts[item.schedulerClass] += 1
  }
  return counts
}

function currentState(
  entry: SchedulerEnqueueDedupeEntry,
  queued: readonly SchedulerQueuedTask[],
  capacityActive: ReadonlyMap<string, ScheduledChild>,
  completions: ReadonlyMap<string, SchedulerCompletionSummary>,
): ScheduledTaskState {
  const workflowId = entry.request.task.workflowId
  const completion = completions.get(workflowId)
  if (completion) return completion.status
  if (capacityActive.has(workflowId)) return 'running'
  if (queued.some((item) => item.request.task.workflowId === workflowId)) {
    return 'queued'
  }
  return entry.state
}

function receiptFor(
  entry: SchedulerEnqueueDedupeEntry,
  queued: readonly SchedulerQueuedTask[],
  capacityActive: ReadonlyMap<string, ScheduledChild>,
  completions: ReadonlyMap<string, SchedulerCompletionSummary>,
): ScheduledTaskReceipt {
  return {
    enqueueId: entry.request.enqueueId,
    taskWorkflowId: entry.request.task.workflowId,
    schedulerClass: entry.schedulerClass,
    sequence: entry.sequence,
    state: currentState(entry, queued, capacityActive, completions),
  }
}

/**
 * The only per-user owner of analysis/image/video execution capacity.
 *
 * A Task leaves capacityActive as soon as its business terminal transaction is
 * committed and acknowledged through RELEASE_CAPACITY. TaskWorkflow owns its
 * own terminal notification and survives Scheduler Continue-As-New.
 */
export async function userTaskSchedulerWorkflow(
  input: UserTaskSchedulerWorkflowInput,
): Promise<UserTaskSchedulerView> {
  if (!input || typeof input !== 'object') fail('TASK_SCHEDULER_INPUT_INVALID')
  requireNonEmpty(input.workflowId, 'TASK_SCHEDULER_WORKFLOW_ID_INVALID')
  requireNonEmpty(input.userId, 'TASK_SCHEDULER_USER_ID_INVALID')
  validateSlotLimits(input.slotLimits)
  if (workflowInfo().workflowId !== input.workflowId) {
    fail('TASK_SCHEDULER_WORKFLOW_ID_MISMATCH', workflowInfo().workflowId, input.workflowId)
  }
  const isContinuedRun = workflowInfo().continuedFromExecutionRunId !== undefined
  if (isContinuedRun !== (input.continuation !== undefined)) {
    fail('TASK_SCHEDULER_CONTINUATION_INVALID')
  }

  let slotLimits = copySlotLimits(input.slotLimits)
  let nextSequence = input.continuation?.nextSequence ?? 0
  let slotLimitsVersion = input.continuation?.slotLimitsVersion ?? 0
  if (
    !Number.isSafeInteger(slotLimitsVersion) ||
    slotLimitsVersion < 0 ||
    slotLimitsVersion > nextSequence
  ) {
    fail('TASK_SCHEDULER_SLOT_LIMITS_VERSION_INVALID', slotLimitsVersion)
  }
  const queued: SchedulerQueuedTask[] = []
  const capacityActive = new Map<string, ScheduledChild>()
  const completions = new Map<string, SchedulerCompletionSummary>()
  const enqueueDedupe = new Map<string, SchedulerEnqueueDedupeEntry>()
  const taskWorkflowToEnqueueId = new Map<string, string>()
  const pendingEnqueues = new Map<string, PendingEnqueueValidation>()

  const restoreEntry = (entry: SchedulerEnqueueDedupeEntry): void => {
    validateScheduledTask(input.workflowId, input.userId, entry.request)
    if (entry.schedulerClass !== null && !isSchedulerClass(entry.schedulerClass)) {
      fail('TASK_SCHEDULER_CLASS_INVALID', entry.schedulerClass)
    }
    if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= 0) {
      fail('TASK_SCHEDULER_SEQUENCE_INVALID', entry.sequence)
    }
    const existing = enqueueDedupe.get(entry.request.enqueueId)
    if (existing && !sameScheduledTask(existing.request, entry.request)) {
      fail('TASK_SCHEDULER_ENQUEUE_REPLAY_DIVERGED', entry.request.enqueueId)
    }
    const existingEnqueueId = taskWorkflowToEnqueueId.get(entry.request.task.workflowId)
    if (existingEnqueueId && existingEnqueueId !== entry.request.enqueueId) {
      fail('TASK_SCHEDULER_TASK_IDENTITY_REUSED', entry.request.task.workflowId)
    }
    enqueueDedupe.set(entry.request.enqueueId, {
      request: entry.request,
      schedulerClass: entry.schedulerClass,
      sequence: entry.sequence,
      state: entry.state,
    })
    taskWorkflowToEnqueueId.set(entry.request.task.workflowId, entry.request.enqueueId)
  }

  if (input.continuation) {
    for (const completion of input.continuation.recentCompletions) {
      if (
        !isTerminalStatus(completion.status) ||
        !Number.isSafeInteger(completion.terminalEventId) ||
        completion.terminalEventId <= 0 ||
        (completion.cancellation !== undefined &&
          (!completion.cancellation ||
            typeof completion.cancellation !== 'object' ||
            !completion.cancellation.requestId ||
            completion.cancellation.requestId !== completion.cancellation.requestId.trim() ||
            !completion.cancellation.reason ||
            completion.cancellation.reason !== completion.cancellation.reason.trim()))
      ) {
        fail('TASK_SCHEDULER_COMPLETION_STATUS_INVALID')
      }
      const existing = completions.get(completion.taskWorkflowId)
      if (
        existing &&
        (existing.status !== completion.status ||
          existing.terminalEventId !== completion.terminalEventId ||
          existing.cancellation?.requestId !== completion.cancellation?.requestId ||
          existing.cancellation?.reason !== completion.cancellation?.reason)
      ) {
        fail('TASK_SCHEDULER_COMPLETION_REPLAY_DIVERGED', completion.taskWorkflowId)
      }
      completions.set(completion.taskWorkflowId, { ...completion })
    }
    for (const entry of input.continuation.recentEnqueues) restoreEntry(entry)
    for (const item of input.continuation.queued) {
      restoreEntry({
        request: item.request,
        schedulerClass: item.schedulerClass,
        sequence: item.sequence,
        state: 'queued',
      })
      queued.push({ ...item })
    }
    for (const item of input.continuation.active) {
      restoreEntry({
        request: item.request,
        schedulerClass: item.schedulerClass,
        sequence: item.sequence,
        state: 'running',
      })
      capacityActive.set(item.request.task.workflowId, { ...item })
    }
  }

  const buildView = (): UserTaskSchedulerView => ({
    workflowId: input.workflowId,
    userId: input.userId,
    slotLimits: copySlotLimits(slotLimits),
    slotLimitsVersion,
    queuedTaskWorkflowIds: queued.map((item) => item.request.task.workflowId),
    capacityActiveTaskWorkflowIds: [...capacityActive.keys()],
    terminalNotificationPendingTaskWorkflowIds: [],
    activeByClass: capacityCounts(capacityActive),
    drainingForContinueAsNew: false,
  })

  const admitScheduledTask = async (
    request: ScheduledTaskRequest,
  ): Promise<ScheduledTaskReceipt> => {
    validateScheduledTask(input.workflowId, input.userId, request)
    const existing = enqueueDedupe.get(request.enqueueId)
    if (existing) {
      if (!sameScheduledTask(existing.request, request)) {
        fail('TASK_SCHEDULER_ENQUEUE_REPLAY_DIVERGED', request.enqueueId)
      }
      return receiptFor(existing, queued, capacityActive, completions)
    }
    const pending = pendingEnqueues.get(request.enqueueId)
    if (pending) {
      if (!sameScheduledTask(pending.request, request)) {
        fail('TASK_SCHEDULER_ENQUEUE_REPLAY_DIVERGED', request.enqueueId)
      }
      return await pending.result
    }
    const existingEnqueueId = taskWorkflowToEnqueueId.get(request.task.workflowId)
    if (existingEnqueueId) {
      fail(
        'TASK_SCHEDULER_TASK_IDENTITY_REUSED',
        request.task.workflowId,
        existingEnqueueId,
        request.enqueueId,
      )
    }
    nextSequence += 1
    const result = new Trigger<ScheduledTaskReceipt>()
    const pendingValidation: PendingEnqueueValidation = {
      request,
      sequence: nextSequence,
      result,
    }
    pendingEnqueues.set(request.enqueueId, pendingValidation)
    taskWorkflowToEnqueueId.set(request.task.workflowId, request.enqueueId)
    void schedulerActivities.resolveTaskSchedulerAdmission(request.task).then(
      (admission) => {
        if (
          !admission ||
          typeof admission !== 'object' ||
          (admission.kind !== 'schedule' && admission.kind !== 'already_terminal')
        ) {
          fail('TASK_SCHEDULER_ADMISSION_INVALID')
        }
        if (admission.schedulerClass !== null && !isSchedulerClass(admission.schedulerClass)) {
          fail('TASK_SCHEDULER_CLASS_NOT_MANAGED')
        }
        validateSlotLimits(admission.slotLimits)
        if (pendingValidation.sequence > slotLimitsVersion) {
          slotLimits = copySlotLimits(admission.slotLimits)
          slotLimitsVersion = pendingValidation.sequence
        }
        const state = admission.kind === 'already_terminal' ? admission.result.status : 'queued'
        const entry: SchedulerEnqueueDedupeEntry = {
          request,
          schedulerClass: admission.schedulerClass,
          sequence: pendingValidation.sequence,
          state,
        }
        enqueueDedupe.set(request.enqueueId, entry)
        if (admission.kind === 'already_terminal') {
          completions.set(request.task.workflowId, {
            taskWorkflowId: request.task.workflowId,
            status: admission.result.status,
            terminalEventId: admission.result.terminal.terminalEventId,
          })
        } else {
          queued.push({
            request,
            schedulerClass: admission.schedulerClass,
            sequence: pendingValidation.sequence,
          })
          queued.sort((left, right) => left.sequence - right.sequence)
        }
        pendingEnqueues.delete(request.enqueueId)
        result.resolve(receiptFor(entry, queued, capacityActive, completions))
      },
      (error: unknown) => {
        pendingEnqueues.delete(request.enqueueId)
        taskWorkflowToEnqueueId.delete(request.task.workflowId)
        result.reject(error)
      },
    )
    return await result
  }

  setHandler(enqueueTask, admitScheduledTask, {
    description: 'Idempotently enqueue one Task under its registry-declared user capacity class.',
  })

  setHandler(
    cancelQueuedTask,
    async (request) => {
      if (!request || typeof request !== 'object') {
        fail('TASK_SCHEDULER_CANCEL_INVALID')
      }
      validateScheduledTask(input.workflowId, input.userId, request.scheduledTask)
      requireNonEmpty(request.cancellation.requestId, 'TASK_CANCEL_REQUEST_ID_INVALID')
      requireNonEmpty(request.cancellation.reason, 'TASK_CANCEL_REASON_INVALID')
      await admitScheduledTask(request.scheduledTask)
      // The admission Activity above yields. The Scheduler main loop may have
      // started the Task before this handler resumes, so decide from the live
      // state rather than the pre-yield admission receipt.
      const entry = enqueueDedupe.get(request.scheduledTask.enqueueId)
      if (!entry) fail('TASK_SCHEDULER_ENQUEUE_STATE_MISSING')
      const receipt = receiptFor(entry, queued, capacityActive, completions)
      const priorCompletion = completions.get(request.scheduledTask.task.workflowId)
      if (
        priorCompletion?.cancellation &&
        (priorCompletion.cancellation.requestId !== request.cancellation.requestId ||
          priorCompletion.cancellation.reason !== request.cancellation.reason)
      ) {
        fail('TASK_SCHEDULER_CANCEL_REPLAY_DIVERGED', request.scheduledTask.task.workflowId)
      }
      if (
        receipt.state === 'completed' ||
        receipt.state === 'failed' ||
        receipt.state === 'canceled'
      ) {
        return { kind: 'terminal', status: receipt.state }
      }
      if (receipt.state !== 'queued') {
        return { kind: 'forward_to_task_workflow' }
      }

      const queueIndex = queued.findIndex(
        (item) =>
          item.request.enqueueId === request.scheduledTask.enqueueId &&
          sameScheduledTask(item.request, request.scheduledTask),
      )
      if (queueIndex < 0) {
        fail('TASK_SCHEDULER_QUEUED_CANCEL_STATE_DIVERGED', request.scheduledTask.task.workflowId)
      }
      queued.splice(queueIndex, 1)
      const terminal = await schedulerActivities.commitTaskTerminal({
        kind: 'canceled',
        workflowId: request.scheduledTask.task.workflowId,
        taskId: request.scheduledTask.task.taskId,
        reason: request.cancellation.reason,
        source: 'user',
      })
      if (
        terminal.taskId !== request.scheduledTask.task.taskId ||
        terminal.status !== 'canceled' ||
        !Number.isSafeInteger(terminal.terminalEventId) ||
        terminal.terminalEventId <= 0
      ) {
        fail(
          'TASK_SCHEDULER_QUEUED_CANCEL_TERMINAL_DIVERGED',
          request.scheduledTask.task.workflowId,
        )
      }
      for (const batchId of terminal.readyFollowUpBatchIds) {
        await schedulerActivities.notifyTaskFollowUp({
          workflowId: request.scheduledTask.task.workflowId,
          taskId: request.scheduledTask.task.taskId,
          batchId,
          terminal,
        })
      }
      entry.state = 'canceled'
      completions.set(request.scheduledTask.task.workflowId, {
        taskWorkflowId: request.scheduledTask.task.workflowId,
        status: 'canceled',
        terminalEventId: terminal.terminalEventId,
        cancellation: { ...request.cancellation },
      })
      return { kind: 'terminal', status: 'canceled' }
    },
    {
      description: 'Cancel one queued Task atomically before any TaskWorkflow is started.',
    },
  )

  setHandler(
    releaseCapacity,
    (release) => {
      if (!release || typeof release !== 'object') {
        fail('TASK_CAPACITY_RELEASE_INVALID')
      }
      requireNonEmpty(release.taskWorkflowId, 'TASK_CAPACITY_RELEASE_WORKFLOW_ID_INVALID')
      requireNonEmpty(release.taskId, 'TASK_CAPACITY_RELEASE_TASK_ID_INVALID')
      if (!Number.isSafeInteger(release.terminalEventId) || release.terminalEventId <= 0) {
        fail('TASK_CAPACITY_RELEASE_EVENT_ID_INVALID')
      }
      if (!isTerminalStatus(release.status)) {
        fail('TASK_CAPACITY_RELEASE_STATUS_INVALID', release.status)
      }
      const child = capacityActive.get(release.taskWorkflowId)
      if (!child || child.request.task.taskId !== release.taskId) {
        const completion = completions.get(release.taskWorkflowId)
        if (
          completion?.status === release.status &&
          completion.terminalEventId === release.terminalEventId
        ) {
          return buildView()
        }
        fail('TASK_CAPACITY_RELEASE_UNKNOWN_TASK', release.taskWorkflowId)
      }
      capacityActive.delete(release.taskWorkflowId)
      const entry = enqueueDedupe.get(child.request.enqueueId)
      if (!entry) fail('TASK_SCHEDULER_ENQUEUE_STATE_MISSING')
      entry.state = release.status
      completions.set(release.taskWorkflowId, {
        taskWorkflowId: release.taskWorkflowId,
        status: release.status,
        terminalEventId: release.terminalEventId,
      })
      return buildView()
    },
    {
      description: 'Release provider capacity after the Task terminal transaction commits.',
    },
  )

  const validateTaskResult = (
    taskWorkflowId: string,
    taskId: string,
    result: TaskWorkflowResult,
  ): void => {
    if (
      !result ||
      typeof result !== 'object' ||
      !result.terminal ||
      typeof result.terminal !== 'object' ||
      result.taskId !== taskId ||
      result.terminal.taskId !== taskId ||
      result.status !== result.terminal.status ||
      !isTerminalStatus(result.status) ||
      !Number.isSafeInteger(result.attempts) ||
      result.attempts < 0 ||
      !Number.isSafeInteger(result.terminal.terminalEventId) ||
      result.terminal.terminalEventId <= 0 ||
      !Array.isArray(result.terminal.readyFollowUpBatchIds) ||
      result.terminal.readyFollowUpBatchIds.length > 64 ||
      new Set(result.terminal.readyFollowUpBatchIds).size !==
        result.terminal.readyFollowUpBatchIds.length ||
      result.terminal.readyFollowUpBatchIds.some(
        (batchId) =>
          typeof batchId !== 'string' || batchId.trim() !== batchId || batchId.length === 0,
      )
    ) {
      fail('TASK_SCHEDULER_CHILD_RESULT_DIVERGED', taskWorkflowId)
    }
  }

  const hasAvailableSlot = (schedulerClass: TaskSchedulerClass | null): boolean =>
    schedulerClass === null ||
    capacityCounts(capacityActive)[schedulerClass] < slotLimits[schedulerClass]

  const startQueuedTasks = async (): Promise<void> => {
    while (true) {
      const queueIndex = queued.findIndex((item) => hasAvailableSlot(item.schedulerClass))
      if (queueIndex < 0) return
      const [item] = queued.splice(queueIndex, 1)
      if (!item) return
      const taskWorkflowId = item.request.task.workflowId
      const childState: ScheduledChild = {
        request: item.request,
        schedulerClass: item.schedulerClass,
        sequence: item.sequence,
      }
      capacityActive.set(taskWorkflowId, childState)
      const entry = enqueueDedupe.get(item.request.enqueueId)
      if (!entry) fail('TASK_SCHEDULER_ENQUEUE_STATE_MISSING')
      entry.state = 'running'
      try {
        await startChild(taskWorkflow, {
          workflowId: taskWorkflowId,
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
          parentClosePolicy: ParentClosePolicy.ABANDON,
          args: [item.request.task],
        })
      } catch {
        const result = await schedulerActivities.commitTaskWorkflowFailure({
          owner: 'scheduler',
          schedulerWorkflowId: input.workflowId,
          enqueueId: item.request.enqueueId,
          task: item.request.task,
        })
        validateTaskResult(taskWorkflowId, item.request.task.taskId, result)
        capacityActive.delete(taskWorkflowId)
        entry.state = result.status
        completions.set(taskWorkflowId, {
          taskWorkflowId,
          status: result.status,
          terminalEventId: result.terminal.terminalEventId,
        })
        for (const batchId of result.terminal.readyFollowUpBatchIds) {
          await schedulerActivities.notifyTaskFollowUp({
            workflowId: taskWorkflowId,
            taskId: result.taskId,
            batchId,
            terminal: result.terminal,
          })
        }
      }
    }
  }

  const buildContinuation = (): UserTaskSchedulerContinuationState => {
    const recentCompletions = [...completions.values()]
      .slice(-RECENT_DEDUPE_LIMIT)
      .map((completion) => ({ ...completion }))
    const retainedCompletedWorkflowIds = new Set(
      recentCompletions.map((completion) => completion.taskWorkflowId),
    )
    const recentEnqueues = [...enqueueDedupe.values()]
      .filter((entry) => retainedCompletedWorkflowIds.has(entry.request.task.workflowId))
      .map((entry) => ({ ...entry }))
    return {
      queued: queued.map((item) => ({ ...item })),
      active: [...capacityActive.values()].map((item) => ({ ...item })),
      recentEnqueues,
      recentCompletions,
      nextSequence,
      slotLimitsVersion,
    }
  }

  while (true) {
    await startQueuedTasks()

    if (workflowInfo().continueAsNewSuggested && allHandlersFinished()) {
      await continueAsNew<typeof userTaskSchedulerWorkflow>({
        workflowId: input.workflowId,
        userId: input.userId,
        slotLimits: copySlotLimits(slotLimits),
        continuation: buildContinuation(),
      })
    }

    await condition(
      () =>
        (workflowInfo().continueAsNewSuggested && allHandlersFinished()) ||
        queued.some((item) => hasAvailableSlot(item.schedulerClass)),
    )
  }
}

setWorkflowOptions(
  { versioningBehavior: TEMPORAL_WORKFLOW.USER_TASK_SCHEDULER.versioningBehavior },
  userTaskSchedulerWorkflow,
)
