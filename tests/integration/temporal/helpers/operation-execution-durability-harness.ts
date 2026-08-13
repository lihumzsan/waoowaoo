import { resolve } from 'node:path'
import { NativeConnection, Worker } from '@temporalio/worker'
import {
  executeOperation as executeProductionOperation,
  resolveTaskSchedulerAdmission,
} from '@/lib/temporal/activities'
import {
  buildTemporalConnectionOptions,
  getTemporalRuntimeConfig,
} from '@/lib/temporal/config'
import type {
  ExecuteOperationActivityInput,
  OperationExecutionWorkflowReceipt,
} from '@/lib/temporal/operation-execution/contracts'
import {
  activateTestWorkerVersion,
  buildTestWorkerDeploymentOptions,
  buildTestWorkerIdentity,
} from './versioned-worker'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null
  const promise = new Promise<T>((resolvePromiseValue) => {
    resolvePromise = resolvePromiseValue
  })
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value)
      resolvePromise = null
    },
  }
}

async function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
): Promise<T> {
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
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.TEMPORAL_TEST_BOOTSTRAP !== '1'
  ) {
    throw new Error('OPERATION_TEMPORAL_TEST_RUNTIME_REQUIRED')
  }
  const namespace = process.env.TEMPORAL_NAMESPACE?.trim()
  const address = process.env.TEMPORAL_ADDRESS?.trim()
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (
    !namespace
    || !namespace.includes('test')
    || !address
    || !databaseUrl
    || new URL(databaseUrl).pathname.replace(/^\//, '') !== 'waoowaoo_test'
  ) {
    throw new Error('OPERATION_TEMPORAL_TEST_RUNTIME_UNSAFE')
  }
}

export interface OperationExecutionDurabilityWorker {
  readonly taskQueue: string
  waitForPostCommitAcknowledgementLoss(): Promise<OperationExecutionWorkflowReceipt>
  close(): Promise<void>
}

export async function startOperationExecutionDurabilityWorker(input: {
  readonly faultExecutionId: string
}): Promise<OperationExecutionDurabilityWorker> {
  requireTemporalTestRuntime()
  const config = getTemporalRuntimeConfig()
  const taskQueue = config.taskQueue
  const workerIdentity = buildTestWorkerIdentity('operation-durability')
  const connection = await NativeConnection.connect(
    buildTemporalConnectionOptions(config),
  )
  const acknowledgementLoss =
    deferred<OperationExecutionWorkflowReceipt>()
  let acknowledgementShouldDrop = true

  const executeOperation = async (
    activityInput: ExecuteOperationActivityInput,
  ): Promise<OperationExecutionWorkflowReceipt> => {
    const receipt = await executeProductionOperation(activityInput)
    if (
      activityInput.envelope.command.executionId === input.faultExecutionId
      && acknowledgementShouldDrop
    ) {
      acknowledgementShouldDrop = false
      acknowledgementLoss.resolve(receipt)
      throw new Error('TEST_OPERATION_ACK_LOST_AFTER_COMMIT')
    }
    return receipt
  }

  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue,
    identity: workerIdentity,
    workflowsPath: resolve(
      process.cwd(),
      'src/lib/temporal/workflows/index.ts',
    ),
    activities: {
      executeOperation,
      resolveTaskSchedulerAdmission,
    },
    workerDeploymentOptions: buildTestWorkerDeploymentOptions(
      'operation-durability',
    ),
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  await activateTestWorkerVersion(
    connection,
    config.namespace,
    taskQueue,
    workerIdentity,
    'operation-durability',
  )
  let closed = false

  return {
    taskQueue,
    async waitForPostCommitAcknowledgementLoss() {
      return await within(
        acknowledgementLoss.promise,
        30_000,
        'OPERATION_POST_COMMIT_ACK_LOSS_TIMEOUT',
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
