import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import type { History } from '@temporalio/common/lib/proto-utils'
import { CancelledFailure, Context, heartbeat } from '@temporalio/activity'
import { NativeConnection, Worker } from '@temporalio/worker'
import {
  admitAssistantRuntimeTaskFollowUp,
  getOrCreateAssistantRuntimeThread,
  loadAssistantRuntimeTaskFollowUp,
} from '@/lib/assistant-runtime/persistence'
import {
  ASSISTANT_RUNTIME_TASK_FOLLOW_UP_PATH,
  parseAssistantRuntimeTaskFollowUpHttpRequest,
  verifyAssistantRuntimeTaskFollowUpAuthorization,
} from '@/lib/assistant-runtime/task-follow-up-http'
import * as productionActivities from '@/lib/temporal/activities'
import { buildTemporalConnectionOptions, getTemporalRuntimeConfig } from '@/lib/temporal/config'
import type {
  CommitTaskTerminalInput,
  NotifyTaskFollowUpInput,
  RunTaskAttemptInput,
  RunTaskAttemptResult,
  TaskTerminalReceipt,
} from '@/lib/temporal/task/contracts'
import {
  activateTestWorkerVersion,
  buildTestTaskQueue,
  buildTestWorkerDeploymentOptions,
  buildTestWorkerIdentity,
} from './versioned-worker'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

interface FollowUpAdmissionServer {
  close(): Promise<void>
}

async function readJsonRequest(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(body))
}

async function listen(server: Server): Promise<AddressInfo> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('TASK_FOLLOW_UP_TEST_SERVER_ADDRESS_INVALID')
  }
  return address
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error)
      else resolveClose()
    })
  })
}

function restoreEnvironment(name: 'INTERNAL_APP_URL' | 'CRON_SECRET', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

/**
 * Real HTTP transport plus the production FollowUpBatch admission owner. The
 * Codex runtime process itself is outside this Task durability oracle; this
 * boundary deliberately stops after the unique Batch/Turn transaction.
 */
async function startFollowUpAdmissionServer(): Promise<FollowUpAdmissionServer> {
  const previousBaseUrl = process.env.INTERNAL_APP_URL
  const previousSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'task-durability-follow-up-secret'
  const server = createServer((request, response) => {
    void (async () => {
      if (
        request.method !== 'POST'
        || request.url !== ASSISTANT_RUNTIME_TASK_FOLLOW_UP_PATH
        || !verifyAssistantRuntimeTaskFollowUpAuthorization(
          typeof request.headers.authorization === 'string'
            ? request.headers.authorization
            : null,
        )
      ) {
        writeJson(response, 401, {
          ok: false,
          code: 'ASSISTANT_RUNTIME_INTERNAL_AUTHENTICATION_FAILED',
        })
        return
      }
      const input = parseAssistantRuntimeTaskFollowUpHttpRequest(
        await readJsonRequest(request),
      )
      const loaded = await loadAssistantRuntimeTaskFollowUp(input.batchId)
      if (loaded.kind === 'cancelled') {
        writeJson(response, 200, {
          ok: true,
          receipt: { outcome: 'cancelled', batchId: input.batchId },
        })
        return
      }
      const thread = await getOrCreateAssistantRuntimeThread(loaded.followUp)
      const admission = await admitAssistantRuntimeTaskFollowUp({
        batchId: input.batchId,
        expected: loaded.followUp,
      })
      writeJson(response, 200, {
        ok: true,
        receipt: {
          outcome: admission.replayed ? 'replayed' : 'accepted',
          batchId: input.batchId,
          threadId: thread.threadId,
          turnId: admission.turn.turnId,
          runtimeThreadId: admission.thread.runtimeThreadId,
          runtimeTurnId: admission.turn.runtimeTurnId,
        },
      })
    })().catch(() => {
      if (!response.headersSent) {
        writeJson(response, 500, {
          ok: false,
          code: 'ASSISTANT_RUNTIME_FOLLOW_UP_FAILED',
        })
      } else {
        response.destroy()
      }
    })
  })
  try {
    const address = await listen(server)
    process.env.INTERNAL_APP_URL = `http://127.0.0.1:${String(address.port)}`
  } catch (error) {
    restoreEnvironment('INTERNAL_APP_URL', previousBaseUrl)
    restoreEnvironment('CRON_SECRET', previousSecret)
    throw error
  }
  let closed = false
  return {
    async close() {
      if (closed) return
      closed = true
      try {
        await closeServer(server)
      } finally {
        restoreEnvironment('INTERNAL_APP_URL', previousBaseUrl)
        restoreEnvironment('CRON_SECRET', previousSecret)
      }
    },
  }
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
  const taskQueue = buildTestTaskQueue(config.taskQueue, 'task-durability')
  const workerIdentity = buildTestWorkerIdentity('task-durability')
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue,
    identity: workerIdentity,
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: productionActivities,
    workerDeploymentOptions: buildTestWorkerDeploymentOptions(
      'task-durability',
    ),
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  await activateTestWorkerVersion(
    connection,
    config.namespace,
    taskQueue,
    workerIdentity,
    'task-durability',
  )
  let closed = false
  return {
    taskQueue,
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
  const taskQueue = buildTestTaskQueue(config.taskQueue, 'task-durability')
  const workerIdentity = buildTestWorkerIdentity('task-durability')
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
    taskQueue,
    identity: workerIdentity,
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: {
      ...productionActivities,
      runTaskAttempt,
    },
    workerDeploymentOptions: buildTestWorkerDeploymentOptions(
      'task-durability',
    ),
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  await activateTestWorkerVersion(
    connection,
    config.namespace,
    taskQueue,
    workerIdentity,
    'task-durability',
  )
  let closed = false
  const release = (): void => {
    if (released) return
    released = true
    releaseHolder.resolve()
  }
  return {
    taskQueue,
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
  const taskQueue = buildTestTaskQueue(config.taskQueue, 'task-durability')
  const workerIdentity = buildTestWorkerIdentity('task-durability')
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
    taskQueue,
    identity: workerIdentity,
    maxHeartbeatThrottleInterval: '50 milliseconds',
    defaultHeartbeatThrottleInterval: '50 milliseconds',
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: {
      ...productionActivities,
      runTaskAttempt,
    },
    workerDeploymentOptions: buildTestWorkerDeploymentOptions(
      'task-durability',
    ),
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  await activateTestWorkerVersion(
    connection,
    config.namespace,
    taskQueue,
    workerIdentity,
    'task-durability',
  )
  let closed = false
  return {
    taskQueue,
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
  const taskQueue = buildTestTaskQueue(config.taskQueue, 'task-durability')
  const workerIdentity = buildTestWorkerIdentity('task-durability')
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  const followUpServer = await startFollowUpAdmissionServer()
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

  let worker: Worker
  try {
    worker = await Worker.create({
      connection,
      namespace: config.namespace,
      taskQueue,
      identity: workerIdentity,
      workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
      activities: {
        ...productionActivities,
        commitTaskTerminal,
        notifyTaskFollowUp,
      },
      workerDeploymentOptions: buildTestWorkerDeploymentOptions(
        'task-durability',
      ),
      shutdownGraceTime: '5 seconds',
    })
  } catch (error) {
    await Promise.allSettled([connection.close(), followUpServer.close()])
    throw error
  }
  const run = worker.run()
  await activateTestWorkerVersion(
    connection,
    config.namespace,
    taskQueue,
    workerIdentity,
    'task-durability',
  )
  let closed = false

  const releaseNotification = (): void => {
    if (notificationWasReleased) return
    notificationWasReleased = true
    notificationRelease.resolve()
  }

  return {
    taskQueue,
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
        try {
          await connection.close()
        } finally {
          await followUpServer.close()
        }
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
