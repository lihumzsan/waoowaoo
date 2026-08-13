import { rm, writeFile } from 'node:fs/promises'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createScopedLogger } from '@/lib/logging/core'
import * as activities from './activities'
import { buildTemporalConnectionOptions, getTemporalWorkerRuntimeConfig } from './config'
import { resolveTemporalWorkflowBundlePath } from './workflow-bundle-path'
import { UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK } from './workflow-registry'

const logger = createScopedLogger({ module: 'temporal.worker' })

async function runTemporalWorker(): Promise<void> {
  const config = getTemporalWorkerRuntimeConfig()
  if (config.workerReadyFile) {
    await rm(config.workerReadyFile, { force: true })
  }
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.namespace,
      taskQueue: config.taskQueue,
      workflowsPath: resolveTemporalWorkflowBundlePath(
        config.workerVersioningEnabled,
      ),
      activities,
      // Remote Activity cancellation is delivered through heartbeats. The
      // SDK default may throttle a 45s heartbeat timeout for ~36s, which is
      // too slow for an interactive Agent stop or message correction.
      maxHeartbeatThrottleInterval: '1 second',
      defaultHeartbeatThrottleInterval: '1 second',
      ...(config.workerVersioningEnabled
        ? {
            workerDeploymentOptions: {
              version: {
                deploymentName: config.workerDeploymentName,
                buildId: config.workerBuildId,
              },
              useWorkerVersioning: true,
              defaultVersioningBehavior: UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK,
            },
          }
        : {}),
    })
    logger.info({
      action: 'temporal.worker.started',
      message: 'Temporal worker started',
      details: {
        namespace: config.namespace,
        taskQueue: config.taskQueue,
        deploymentName: config.workerDeploymentName,
        buildId: config.workerBuildId,
        versioningEnabled: config.workerVersioningEnabled,
      },
    })
    const runPromise = worker.run()
    try {
      if (config.workerReadyFile) {
        await writeFile(config.workerReadyFile, `${process.pid}\n`, { encoding: 'utf8' })
      }
      await runPromise
    } catch (error: unknown) {
      if (worker.getState() === 'RUNNING') {
        worker.shutdown()
      }
      await runPromise.catch(() => undefined)
      throw error
    } finally {
      if (config.workerReadyFile) {
        await rm(config.workerReadyFile, { force: true })
      }
    }
  } finally {
    await connection.close()
  }
}

void runTemporalWorker().catch((error: unknown) => {
  logger.error({
    action: 'temporal.worker.failed',
    message: 'Temporal worker failed',
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : { message: String(error) },
  })
  process.exitCode = 1
})
