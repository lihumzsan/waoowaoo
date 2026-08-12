import { resolve } from 'node:path'
import { heartbeat } from '@temporalio/activity'
import { NativeConnection, Worker } from '@temporalio/worker'
import * as productionActivities from '@/lib/temporal/activities'
import {
  buildTemporalConnectionOptions,
  getTemporalRuntimeConfig,
} from '@/lib/temporal/config'
import type {
  RunTaskAttemptInput,
  RunTaskAttemptResult,
} from '@/lib/temporal/task/contracts'
import {
  activateTestWorkerVersion,
  buildTestTaskQueue,
  buildTestWorkerDeploymentOptions,
  buildTestWorkerIdentity,
} from './versioned-worker'

const READY_MARKER = '[task-durability-worker] READY'
const BLOCKED_MARKER =
  '[task-durability-worker] RUN_RESULT_DURABLY_LOADED_AND_BLOCKED'

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.TEMPORAL_TEST_BOOTSTRAP !== '1'
  ) {
    throw new Error('TASK_DURABILITY_CHILD_RUNTIME_REQUIRED')
  }
  const config = getTemporalRuntimeConfig()
  const taskQueue = buildTestTaskQueue(config.taskQueue, 'task-durability')
  const workerIdentity = buildTestWorkerIdentity('task-durability')
  const connection = await NativeConnection.connect(
    buildTemporalConnectionOptions(config),
  )
  const runTaskAttempt = async (
    input: RunTaskAttemptInput,
  ): Promise<RunTaskAttemptResult> => {
    const result = await productionActivities.runTaskAttempt(input)
    heartbeat({
      version: 1,
      workflowId: input.workflowId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      businessAttempt: input.attempt,
    })
    await new Promise<void>((resolveWait) => {
      const timer = setTimeout(resolveWait, 200)
      timer.unref()
    })
    heartbeat({
      version: 1,
      workflowId: input.workflowId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      businessAttempt: input.attempt,
    })
    console.log(`${BLOCKED_MARKER}:${input.taskId}:${input.attemptId}`)
    await new Promise<never>(() => undefined)
    return result
  }
  try {
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
        ...productionActivities,
        runTaskAttempt,
      },
      maxHeartbeatThrottleInterval: '50 milliseconds',
      defaultHeartbeatThrottleInterval: '50 milliseconds',
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
    console.log(READY_MARKER)
    await run
  } finally {
    await connection.close()
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `${error.name}:${error.message}\n${error.stack ?? ''}`
      : String(error),
  )
  process.exitCode = 1
})
