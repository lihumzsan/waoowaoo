import { fileURLToPath } from 'node:url'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createScopedLogger } from '@/lib/logging/core'
import * as activities from './activities'
import { buildTemporalConnectionOptions, getTemporalWorkerRuntimeConfig } from './config'
import { UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK } from './workflow-registry'

const logger = createScopedLogger({ module: 'temporal.worker' })

async function runTemporalWorker(): Promise<void> {
  const config = getTemporalWorkerRuntimeConfig()
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.namespace,
      taskQueue: config.taskQueue,
      workflowsPath: fileURLToPath(new URL('./workflows/index.ts', import.meta.url)),
      activities,
      // Remote Activity cancellation is delivered through heartbeats. The
      // SDK default may throttle a 45s heartbeat timeout for ~36s, which is
      // too slow for an interactive Agent stop or message correction.
      maxHeartbeatThrottleInterval: '1 second',
      defaultHeartbeatThrottleInterval: '1 second',
      workerDeploymentOptions: config.workerVersioningEnabled
        ? {
            version: {
              deploymentName: config.workerDeploymentName,
              buildId: config.workerBuildId,
            },
            useWorkerVersioning: true,
            defaultVersioningBehavior: UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK,
          }
        : {
            version: {
              deploymentName: config.workerDeploymentName,
              buildId: config.workerBuildId,
            },
            useWorkerVersioning: false,
          },
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
    await worker.run()
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
