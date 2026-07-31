import { resolve } from 'node:path'
import type { History } from '@temporalio/common/lib/proto-utils'
import { CancelledFailure, Context, heartbeat } from '@temporalio/activity'
import { NativeConnection, Worker } from '@temporalio/worker'
import * as productionActivities from '@/lib/temporal/activities'
import { buildTemporalConnectionOptions, getTemporalRuntimeConfig } from '@/lib/temporal/config'
import type {
  CommitTaskTerminalInput,
  NotifyTaskFollowUpInput,
  RunTaskAttemptInput,
  RunTaskAttemptResult,
  TaskTerminalReceipt,
} from '@/lib/temporal/task/contracts'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value)
      resolvePromise = null
    },
  }
}

async function within<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs)
        timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function requireTemporalTestRuntime(): void {
  if (process.env.NODE_ENV !== 'test' || process.env.TEMPORAL_TEST_BOOTSTRAP !== '1') {
    throw new Error('TASK_TEMPORAL_TEST_RUNTIME_REQUIRED')
  }
  const namespace = process.env.TEMPORAL_NAMESPACE?.trim()
  const address = process.env.TEMPORAL_ADDRESS?.trim()
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (
    !namespace ||
    !namespace.includes('test') ||
    !address ||
    !databaseUrl ||
    new URL(databaseUrl).pathname.replace(/^\//, '') !== 'waoowaoo_test'
  ) {
    throw new Error('TASK_TEMPORAL_TEST_RUNTIME_UNSAFE')
  }
}

export interface TaskDurabilityWorkerHarness {
  readonly taskQueue: string
  waitForTerminalPostCommitFault(): Promise<TaskTerminalReceipt>
  waitForFollowUpNotificationBlocked(): Promise<void>
  releaseFollowUpNotification(): void
  waitForFollowUpPostCommitFault(): Promise<void>
  close(): Promise<void>
}

export interface TaskProductionWorkerHarness {
  readonly taskQueue: string
  close(): Promise<void>
}

export interface TaskLateCancelWorkerHarness {
  readonly taskQueue: string
  waitForHandlerCheckpointCommit(): Promise<void>
  waitForCancellationAcknowledged(): Promise<void>
  close(): Promise<void>
}

export interface TaskQueuedCancelWorkerHarness {
  readonly taskQueue: string
  waitForCapacityHeld(): Promise<void>
  releaseCapacityHolder(): void
  close(): Promise<void>
}

export async function startTaskProductionWorker(): Promise<TaskProductionWorkerHarness> {
  requireTemporalTestRuntime()
  const config = getTemporalRuntimeConfig()
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: productionActivities,
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  let closed = false
  return {
    taskQueue: config.taskQueue,
    async close() {
      if (closed) return
      closed = true
      worker.shutdown()
      try {
        await run
      } finally {
        await connection.close()
      }
    },
  }
}

export async function startTaskQueuedCancelWorker(input: {
  readonly capacityHolderTaskId: string
}): Promise<TaskQueuedCancelWorkerHarness> {
  requireTemporalTestRuntime()
  const config = getTemporalRuntimeConfig()
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  const capacityHeld = deferred<void>()
  const releaseHolder = deferred<void>()
  let released = false

  const runTaskAttempt = async (
    activityInput: RunTaskAttemptInput,
  ): Promise<RunTaskAttemptResult> => {
    if (activityInput.taskId !== input.capacityHolderTaskId) {
      return await productionActivities.runTaskAttempt(activityInput)
    }
    capacityHeld.resolve()
    const heartbeatTimer = setInterval(() => {
      heartbeat({
        version: 1,
        workflowId: activityInput.workflowId,
        taskId: activityInput.taskId,
        attemptId: activityInput.attemptId,
        businessAttempt: activityInput.attempt,
      })
    }, 25)
    heartbeatTimer.unref()
    try {
      await releaseHolder.promise
    } finally {
      clearInterval(heartbeatTimer)
    }
    return await productionActivities.runTaskAttempt(activityInput)
  }

  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: {
      ...productionActivities,
      runTaskAttempt,
    },
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  let closed = false
  const release = (): void => {
    if (released) return
    released = true
    releaseHolder.resolve()
  }
  return {
    taskQueue: config.taskQueue,
    async waitForCapacityHeld() {
      await within(capacityHeld.promise, 30_000, 'TASK_QUEUED_CANCEL_CAPACITY_HOLDER_TIMEOUT')
    },
    releaseCapacityHolder: release,
    async close() {
      if (closed) return
      closed = true
      release()
      worker.shutdown()
      try {
        await run
      } finally {
        await connection.close()
      }
    },
  }
}

export async function startTaskLateCancelWorker(input: {
  readonly taskId: string
}): Promise<TaskLateCancelWorkerHarness> {
  requireTemporalTestRuntime()
  const config = getTemporalRuntimeConfig()
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  const checkpointCommitted = deferred<void>()
  const cancellationAcknowledged = deferred<void>()

  const runTaskAttempt = async (
    activityInput: RunTaskAttemptInput,
  ): Promise<RunTaskAttemptResult> => {
    const result = await productionActivities.runTaskAttempt(activityInput)
    if (activityInput.taskId !== input.taskId || result.kind !== 'completed') {
      return result
    }
    checkpointCommitted.resolve()
    const signal = Context.current().cancellationSignal
    const heartbeatTimer = setInterval(() => {
      try {
        heartbeat({
          version: 1,
          workflowId: activityInput.workflowId,
          taskId: activityInput.taskId,
          attemptId: activityInput.attemptId,
          businessAttempt: activityInput.attempt,
        })
      } catch {
        // The cancellation signal below is the authoritative observation.
      }
    }, 25)
    heartbeatTimer.unref()
    try {
      if (!signal.aborted) {
        await new Promise<void>((resolveCancellation) => {
          signal.addEventListener('abort', () => resolveCancellation(), {
            once: true,
          })
        })
      }
    } finally {
      clearInterval(heartbeatTimer)
    }
    cancellationAcknowledged.resolve()
    throw new CancelledFailure('TEST_TASK_CANCEL_AFTER_HANDLER_CHECKPOINT_COMMIT')
  }

  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: {
      ...productionActivities,
      runTaskAttempt,
    },
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  let closed = false
  return {
    taskQueue: config.taskQueue,
    async waitForHandlerCheckpointCommit() {
      await within(
        checkpointCommitted.promise,
        30_000,
        'TASK_LATE_CANCEL_CHECKPOINT_COMMIT_TIMEOUT',
      )
    },
    async waitForCancellationAcknowledged() {
      await within(
        cancellationAcknowledged.promise,
        30_000,
        'TASK_LATE_CANCEL_ACKNOWLEDGEMENT_TIMEOUT',
      )
    },
    async close() {
      if (closed) return
      closed = true
      worker.shutdown()
      try {
        await run
      } finally {
        await connection.close()
      }
    },
  }
}

export async function startTaskDurabilityWorker(input: {
  readonly faultTaskId: string
  readonly faultBatchId: string
}): Promise<TaskDurabilityWorkerHarness> {
  requireTemporalTestRuntime()
  const config = getTemporalRuntimeConfig()
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  const terminalFault = deferred<TaskTerminalReceipt>()
  const notificationBlocked = deferred<void>()
  const notificationRelease = deferred<void>()
  const notificationFault = deferred<void>()
  let terminalAckShouldDrop = true
  let notificationAckShouldDrop = true
  let notificationWasReleased = false

  const commitTaskTerminal = async (
    activityInput: CommitTaskTerminalInput,
  ): Promise<TaskTerminalReceipt> => {
    const receipt = await productionActivities.commitTaskTerminal(activityInput)
    if (activityInput.taskId === input.faultTaskId && terminalAckShouldDrop) {
      terminalAckShouldDrop = false
      terminalFault.resolve(receipt)
      throw new Error('TEST_TASK_TERMINAL_ACK_LOST_AFTER_COMMIT')
    }
    return receipt
  }

  const notifyTaskFollowUp = async (activityInput: NotifyTaskFollowUpInput): Promise<void> => {
    if (activityInput.batchId !== input.faultBatchId) {
      await productionActivities.notifyTaskFollowUp(activityInput)
      return
    }
    notificationBlocked.resolve()
    await notificationRelease.promise
    await productionActivities.notifyTaskFollowUp(activityInput)
    if (notificationAckShouldDrop) {
      notificationAckShouldDrop = false
      notificationFault.resolve()
      throw new Error('TEST_TASK_FOLLOW_UP_ACK_LOST_AFTER_COMMIT')
    }
  }

  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: {
      ...productionActivities,
      commitTaskTerminal,
      notifyTaskFollowUp,
    },
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  let closed = false

  const releaseNotification = (): void => {
    if (notificationWasReleased) return
    notificationWasReleased = true
    notificationRelease.resolve()
  }

  return {
    taskQueue: config.taskQueue,
    async waitForTerminalPostCommitFault() {
      return await within(terminalFault.promise, 30_000, 'TASK_TERMINAL_POST_COMMIT_FAULT_TIMEOUT')
    },
    async waitForFollowUpNotificationBlocked() {
      await within(notificationBlocked.promise, 30_000, 'TASK_FOLLOW_UP_BLOCK_TIMEOUT')
    },
    releaseFollowUpNotification: releaseNotification,
    async waitForFollowUpPostCommitFault() {
      await within(notificationFault.promise, 30_000, 'TASK_FOLLOW_UP_POST_COMMIT_FAULT_TIMEOUT')
    },
    async close() {
      if (closed) return
      closed = true
      releaseNotification()
      worker.shutdown()
      try {
        await run
      } finally {
        await connection.close()
      }
    },
  }
}

type HistoryEvent = NonNullable<History['events']>[number]

function eventIdKey(eventId: HistoryEvent['eventId']): string {
  return eventId?.toString() ?? ''
}

function scheduledActivityTypes(history: History): ReadonlyMap<string, string> {
  const scheduledTypes = new Map<string, string>()
  for (const event of history.events ?? []) {
    const attributes = event.activityTaskScheduledEventAttributes
    if (!attributes) continue
    scheduledTypes.set(eventIdKey(event.eventId), attributes.activityType?.name ?? '')
  }
  return scheduledTypes
}

export function activityAttempts(history: History, activityType: string): number[] {
  const scheduledTypes = scheduledActivityTypes(history)
  const attempts: number[] = []
  for (const event of history.events ?? []) {
    const attributes = event.activityTaskStartedEventAttributes
    if (!attributes) continue
    if (scheduledTypes.get(eventIdKey(attributes.scheduledEventId)) === activityType) {
      attempts.push(attributes.attempt ?? 0)
    }
  }
  return attempts
}
