import {
  ActivityCancellationType,
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  CancelledFailure,
  TimeoutFailure,
  condition,
  defineUpdate,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow'
import {
  TASK_WORKFLOW_UPDATE_NAME,
  type CommitTaskTerminalInput,
  type RunTaskAttemptResult,
  type TaskAttemptFailure,
  type TaskCancelRequest,
  type TaskTerminalReceipt,
  type TaskWorkflowActivities,
  type TaskWorkflowInput,
  type TaskWorkflowResult,
  type TaskWorkflowView,
} from '../task/contracts'

const cancelTask = defineUpdate<TaskWorkflowView, [TaskCancelRequest]>(
  TASK_WORKFLOW_UPDATE_NAME.CANCEL,
)

const lifecycleActivities = proxyActivities<
  Pick<
    TaskWorkflowActivities,
    | 'initializeTaskWorkflow'
    | 'beginTaskAttempt'
    | 'commitTaskTerminal'
    | 'commitTaskWorkflowFailure'
  >
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
  },
})

const handoffActivities = proxyActivities<
  Pick<TaskWorkflowActivities, 'releaseTaskCapacity' | 'notifyTaskFollowUp'>
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
  },
})

const compensationActivities = proxyActivities<
  Pick<TaskWorkflowActivities, 'cancelTaskProviderJobs'>
>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
  },
})

const attemptActivities = proxyActivities<Pick<TaskWorkflowActivities, 'runTaskAttempt'>>({
  startToCloseTimeout: '30 days',
  heartbeatTimeout: '45 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
  },
})

type SettledAttempt =
  | {
      kind: 'resolved'
      result: RunTaskAttemptResult
    }
  | {
      kind: 'rejected'
      error: unknown
    }

function fail(code: string, ...details: unknown[]): never {
  throw ApplicationFailure.nonRetryable(code, code, ...details)
}

function requireNonEmpty(value: string, code: string): void {
  if (!value || value !== value.trim()) fail(code)
}

function requireCancelRequest(request: TaskCancelRequest): void {
  if (!request || typeof request !== 'object') fail('TASK_CANCEL_INVALID')
  requireNonEmpty(request.requestId, 'TASK_CANCEL_REQUEST_ID_INVALID')
  requireNonEmpty(request.reason, 'TASK_CANCEL_REASON_INVALID')
}

function copyView(view: TaskWorkflowView): TaskWorkflowView {
  return {
    ...view,
    terminal: view.terminal ? { ...view.terminal } : null,
  }
}

function findFailureCause<T extends Error>(
  error: unknown,
  constructor: new (...args: never[]) => T,
): T | null {
  let current: unknown = error
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof constructor) return current
    if (!(current instanceof Error) || seen.has(current)) return null
    seen.add(current)
    current = current.cause
  }
  return null
}

function infrastructureAttemptFailure(error: ActivityFailure): TaskAttemptFailure {
  if (findFailureCause(error, TimeoutFailure)) {
    return {
      errorCode: 'GENERATION_TIMEOUT',
      errorMessage: 'Task Activity timed out',
      errorDetails: null,
      failureClass: 'TRANSIENT_PROVIDER',
      retryDisposition: 'retryable',
    }
  }
  return {
    errorCode: 'TASK_ACTIVITY_FAILED',
    errorMessage: 'Task Activity failed after infrastructure retries',
    errorDetails: null,
    failureClass: 'TRANSIENT_PROVIDER',
    retryDisposition: 'retryable',
  }
}

function retryDelayMs(baseMs: number, completedAttempt: number): number {
  return baseMs * Math.pow(2, completedAttempt - 1)
}

function requireSettledAttempt(value: SettledAttempt | null): SettledAttempt {
  if (!value) fail('TASK_ATTEMPT_SETTLEMENT_MISSING')
  return value
}

function assertTerminalReceipt(
  input: TaskWorkflowInput,
  expectedStatus: TaskWorkflowResult['status'],
  receipt: TaskTerminalReceipt,
): void {
  if (
    !receipt ||
    typeof receipt !== 'object' ||
    receipt.taskId !== input.taskId ||
    receipt.status !== expectedStatus ||
    !Number.isSafeInteger(receipt.terminalEventId) ||
    receipt.terminalEventId <= 0 ||
    !Array.isArray(receipt.readyFollowUpBatchIds) ||
    receipt.readyFollowUpBatchIds.length > 64 ||
    new Set(receipt.readyFollowUpBatchIds).size !== receipt.readyFollowUpBatchIds.length ||
    receipt.readyFollowUpBatchIds.some(
      (batchId) =>
        typeof batchId !== 'string' || batchId.trim() !== batchId || batchId.length === 0,
    )
  ) {
    fail('TASK_TERMINAL_RECEIPT_DIVERGED')
  }
}

/**
 * The only lifecycle owner for one long Task.
 *
 * Temporal Activity retries always reuse the same attemptId. A new business
 * attempt is created only after the handler returns a classified retryable
 * failure and the frozen Task policy allows another attempt.
 */
async function runTaskWorkflow(input: TaskWorkflowInput): Promise<TaskWorkflowResult> {
  if (!input || typeof input !== 'object') fail('TASK_WORKFLOW_INPUT_INVALID')
  requireNonEmpty(input.workflowId, 'TASK_WORKFLOW_ID_INVALID')
  requireNonEmpty(input.schedulerWorkflowId, 'TASK_SCHEDULER_WORKFLOW_ID_INVALID')
  requireNonEmpty(input.taskId, 'TASK_ID_INVALID')
  requireNonEmpty(input.userId, 'TASK_USER_ID_INVALID')
  if (workflowInfo().workflowId !== input.workflowId) {
    fail('TASK_WORKFLOW_ID_MISMATCH', workflowInfo().workflowId, input.workflowId)
  }

  const rootScope = CancellationScope.current()
  let currentAttemptScope: CancellationScope | null = null
  let cancelReason: string | null = null
  const cancelRequests = new Map<string, string>()
  const view: TaskWorkflowView = {
    workflowId: input.workflowId,
    taskId: input.taskId,
    status: 'initializing',
    attempt: 0,
    maxAttempts: null,
    cancelRequested: false,
    capacityReleased: false,
    terminal: null,
  }

  setHandler(
    cancelTask,
    (request) => {
      const existingReason = cancelRequests.get(request.requestId)
      if (existingReason !== undefined) {
        if (existingReason !== request.reason) {
          fail('TASK_CANCEL_REPLAY_DIVERGED', request.requestId)
        }
        return copyView(view)
      }
      cancelRequests.set(request.requestId, request.reason)
      if (view.status === 'completed' || view.status === 'failed' || view.status === 'canceled') {
        return copyView(view)
      }
      cancelReason = request.reason
      view.cancelRequested = true
      view.status = 'cancelling'
      currentAttemptScope?.cancel()
      return copyView(view)
    },
    {
      validator: requireCancelRequest,
      description: 'Request durable cancellation of this Task lifecycle.',
    },
  )

  const completeWorkflow = async (result: TaskWorkflowResult): Promise<TaskWorkflowResult> => {
    if (
      result.taskId !== input.taskId ||
      result.terminal.taskId !== input.taskId ||
      result.status !== result.terminal.status ||
      !Number.isSafeInteger(result.attempts) ||
      result.attempts < 0
    ) {
      fail('TASK_TERMINAL_RESULT_DIVERGED')
    }
    assertTerminalReceipt(input, result.status, result.terminal)
    view.status = result.status
    view.attempt = result.attempts
    view.terminal = result.terminal

    await CancellationScope.nonCancellable(async () => {
      await handoffActivities.releaseTaskCapacity({
        schedulerWorkflowId: input.schedulerWorkflowId,
        taskWorkflowId: input.workflowId,
        taskId: input.taskId,
        terminalEventId: result.terminal.terminalEventId,
        status: result.status,
      })
    })
    view.capacityReleased = true

    if (result.terminal.readyFollowUpBatchIds.length > 0) {
      view.status = 'notifying'
      for (const batchId of result.terminal.readyFollowUpBatchIds) {
        await CancellationScope.nonCancellable(async () => {
          await handoffActivities.notifyTaskFollowUp({
            workflowId: input.workflowId,
            taskId: input.taskId,
            batchId,
            terminal: result.terminal,
          })
        })
      }
      view.status = result.status
    }
    // Follow-up is required product handoff. Provider cancellation is only
    // resource compensation and must never get priority over that handoff.
    if (result.status === 'canceled') {
      await CancellationScope.nonCancellable(async () => {
        await compensationActivities.cancelTaskProviderJobs({
          workflowId: input.workflowId,
          taskId: input.taskId,
          userId: input.userId,
          terminalEventId: result.terminal.terminalEventId,
        })
      })
    }
    return result
  }

  const initialized = await CancellationScope.nonCancellable(
    async () =>
      await lifecycleActivities.initializeTaskWorkflow({
        workflowId: input.workflowId,
        schedulerWorkflowId: input.schedulerWorkflowId,
        taskId: input.taskId,
        userId: input.userId,
        taskType: input.taskType,
      }),
  )
  if (
    !initialized ||
    typeof initialized !== 'object' ||
    (initialized.kind !== 'ready' && initialized.kind !== 'already_terminal')
  ) {
    fail('TASK_INITIAL_STATE_INVALID')
  }
  if (initialized.kind === 'already_terminal') {
    assertTerminalReceipt(input, initialized.result.status, initialized.result.terminal)
    return await completeWorkflow(initialized.result)
  }

  const { policy } = initialized
  if (
    !policy ||
    typeof policy !== 'object' ||
    !Number.isSafeInteger(policy.maxAttempts) ||
    policy.maxAttempts <= 0 ||
    !Number.isSafeInteger(policy.retryBackoffBaseMs) ||
    policy.retryBackoffBaseMs <= 0 ||
    (policy.executionDeadlineMs !== null &&
      (!Number.isSafeInteger(policy.executionDeadlineMs) || policy.executionDeadlineMs <= 0))
  ) {
    fail('TASK_WORKFLOW_POLICY_INVALID')
  }
  view.maxAttempts = policy.maxAttempts

  const commitTerminal = async (
    terminalInput: CommitTaskTerminalInput,
    requestedStatus: TaskWorkflowResult['status'],
  ): Promise<TaskWorkflowResult> => {
    const terminal = await CancellationScope.nonCancellable(
      async () => await lifecycleActivities.commitTaskTerminal(terminalInput),
    )
    const committedStatus = terminal.status
    const committedResultWonLateCancellation =
      requestedStatus === 'canceled' && committedStatus === 'completed'
    if (committedStatus !== requestedStatus && !committedResultWonLateCancellation) {
      fail('TASK_TERMINAL_STATUS_DIVERGED', requestedStatus, committedStatus)
    }
    assertTerminalReceipt(input, committedStatus, terminal)
    return await completeWorkflow({
      taskId: input.taskId,
      status: committedStatus,
      attempts: view.attempt,
      terminal,
    })
  }

  while (view.attempt < policy.maxAttempts) {
    if (view.cancelRequested) {
      return await commitTerminal(
        {
          kind: 'canceled',
          workflowId: input.workflowId,
          taskId: input.taskId,
          reason: cancelReason ?? 'TASK_CANCELLED',
          source: cancelReason ? 'user' : 'system',
        },
        'canceled',
      )
    }

    view.attempt += 1
    view.status = 'running'
    const attemptId = `${input.workflowId}:attempt:${String(view.attempt)}`
    await CancellationScope.nonCancellable(async () => {
      await lifecycleActivities.beginTaskAttempt({
        workflowId: input.workflowId,
        taskId: input.taskId,
        userId: input.userId,
        taskType: input.taskType,
        attempt: view.attempt,
        attemptId,
      })
    })
    if (view.cancelRequested) continue

    let attemptResult: RunTaskAttemptResult
    let deadlineExpired = false
    const executeAttempt = async (): Promise<RunTaskAttemptResult> => {
      const scope = new CancellationScope({ cancellable: true })
      currentAttemptScope = scope
      return await scope.run(
        async () =>
          await attemptActivities.runTaskAttempt({
            workflowId: input.workflowId,
            taskId: input.taskId,
            userId: input.userId,
            taskType: input.taskType,
            attempt: view.attempt,
            attemptId,
            executionDeadlineMs: policy.executionDeadlineMs,
          }),
      )
    }
    const executeWithinDeadline = async (): Promise<RunTaskAttemptResult> => {
      if (policy.executionDeadlineMs === null) return await executeAttempt()
      let settled: SettledAttempt | null = null
      void executeAttempt().then(
        (result) => {
          settled = { kind: 'resolved', result }
        },
        (error: unknown) => {
          settled = { kind: 'rejected', error }
        },
      )
      const completedBeforeDeadline = await condition(
        () => settled !== null,
        policy.executionDeadlineMs,
      )
      if (!completedBeforeDeadline) {
        deadlineExpired = true
        currentAttemptScope?.cancel()
        await condition(() => settled !== null)
      }
      const finalSettlement = requireSettledAttempt(settled)
      if (finalSettlement.kind === 'rejected') throw finalSettlement.error
      return finalSettlement.result
    }

    try {
      attemptResult = await executeWithinDeadline()
    } catch (error) {
      currentAttemptScope = null
      const cancellation = findFailureCause(error, CancelledFailure)
      if (cancellation) {
        if (view.cancelRequested || rootScope.consideredCancelled) {
          return await commitTerminal(
            {
              kind: 'canceled',
              workflowId: input.workflowId,
              taskId: input.taskId,
              reason: cancelReason ?? 'TASK_WORKFLOW_CANCELLED',
              source: cancelReason ? 'user' : 'system',
            },
            'canceled',
          )
        }
        attemptResult = {
          kind: 'failed',
          failure: {
            errorCode: deadlineExpired ? 'GENERATION_TIMEOUT' : 'TASK_ACTIVITY_CANCELLED',
            errorMessage: deadlineExpired
              ? 'Task execution deadline exceeded'
              : 'Task Activity was canceled by the execution system',
            errorDetails: null,
            failureClass: 'TRANSIENT_PROVIDER',
            retryDisposition: 'retryable',
          },
        }
      } else {
        if (!(error instanceof ActivityFailure)) throw error
        attemptResult = {
          kind: 'failed',
          failure: infrastructureAttemptFailure(error),
        }
      }
    }
    currentAttemptScope = null

    if (!attemptResult || typeof attemptResult !== 'object') {
      fail('TASK_ATTEMPT_RESULT_INVALID')
    }
    if (attemptResult.kind === 'completed') {
      requireNonEmpty(attemptResult.executionCheckpointId, 'TASK_EXECUTION_CHECKPOINT_ID_INVALID')
      return await commitTerminal(
        {
          kind: 'completed',
          workflowId: input.workflowId,
          taskId: input.taskId,
          attempt: view.attempt,
          executionCheckpointId: attemptResult.executionCheckpointId,
        },
        'completed',
      )
    }
    if (view.cancelRequested) continue
    if (attemptResult.kind === 'canceled') {
      requireNonEmpty(attemptResult.reason, 'TASK_ATTEMPT_CANCEL_REASON_INVALID')
      return await commitTerminal(
        {
          kind: 'canceled',
          workflowId: input.workflowId,
          taskId: input.taskId,
          reason: attemptResult.reason,
          source: 'system',
        },
        'canceled',
      )
    }
    if (attemptResult.kind !== 'failed') {
      fail('TASK_ATTEMPT_RESULT_KIND_INVALID')
    }
    const { failure } = attemptResult
    if (!failure || typeof failure !== 'object') {
      fail('TASK_ATTEMPT_FAILURE_INVALID')
    }
    requireNonEmpty(failure.errorCode, 'TASK_ATTEMPT_ERROR_CODE_INVALID')
    requireNonEmpty(failure.errorMessage, 'TASK_ATTEMPT_ERROR_MESSAGE_INVALID')
    if (failure.retryDisposition !== 'retryable' && failure.retryDisposition !== 'final') {
      fail('TASK_ATTEMPT_RETRY_DISPOSITION_INVALID')
    }

    const canRetry = failure.retryDisposition === 'retryable' && view.attempt < policy.maxAttempts
    if (canRetry) {
      view.status = 'retry_wait'
      try {
        await condition(
          () => view.cancelRequested,
          retryDelayMs(policy.retryBackoffBaseMs, view.attempt),
        )
      } catch (error) {
        if (!findFailureCause(error, CancelledFailure)) throw error
        cancelReason ??= 'TASK_WORKFLOW_CANCELLED'
      }
      continue
    }

    return await commitTerminal(
      {
        kind: 'failed',
        workflowId: input.workflowId,
        taskId: input.taskId,
        attempt: view.attempt,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        errorDetails: failure.errorDetails,
        source: failure.errorCode === 'GENERATION_TIMEOUT' ? 'timeout' : 'worker',
      },
      'failed',
    )
  }

  fail('TASK_WORKFLOW_ATTEMPT_LOOP_EXHAUSTED')
}

/**
 * A Scheduler run can Continue-As-New while this child remains active, so the
 * child itself must own fail-closed settlement. Expected handler failures are
 * handled inside runTaskWorkflow; this boundary only catches Workflow-level
 * invariant/activity failures that would otherwise strand user capacity.
 */
export async function taskWorkflow(input: TaskWorkflowInput): Promise<TaskWorkflowResult> {
  try {
    return await runTaskWorkflow(input)
  } catch {
    const result = await CancellationScope.nonCancellable(
      async () =>
        await lifecycleActivities.commitTaskWorkflowFailure({
          owner: 'task_workflow',
          schedulerWorkflowId: input.schedulerWorkflowId,
          enqueueId: `task-workflow-self-failure:${input.workflowId}`,
          task: input,
        }),
    )
    assertTerminalReceipt(input, result.status, result.terminal)
    await CancellationScope.nonCancellable(async () => {
      await handoffActivities.releaseTaskCapacity({
        schedulerWorkflowId: input.schedulerWorkflowId,
        taskWorkflowId: input.workflowId,
        taskId: input.taskId,
        terminalEventId: result.terminal.terminalEventId,
        status: result.status,
      })
    })
    for (const batchId of result.terminal.readyFollowUpBatchIds) {
      await CancellationScope.nonCancellable(async () => {
        await handoffActivities.notifyTaskFollowUp({
          workflowId: input.workflowId,
          taskId: input.taskId,
          batchId,
          terminal: result.terminal,
        })
      })
    }
    // Preserve the same required-handoff-before-compensation order when the
    // Workflow-level fail-closed boundary settles an already canceled Task.
    if (result.status === 'canceled') {
      await CancellationScope.nonCancellable(async () => {
        await compensationActivities.cancelTaskProviderJobs({
          workflowId: input.workflowId,
          taskId: input.taskId,
          userId: input.userId,
          terminalEventId: result.terminal.terminalEventId,
        })
      })
    }
    return result
  }
}
