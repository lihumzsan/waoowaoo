import { fileURLToPath } from 'node:url'
import { VersioningBehavior } from '@temporalio/common'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createScopedLogger } from '@/lib/logging/core'
import * as activities from './activities'
import { buildTemporalConnectionOptions, getTemporalWorkerRuntimeConfig } from './config'

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
      workerDeploymentOptions: config.workerVersioningEnabled
        ? {
            version: {
              deploymentName: config.workerDeploymentName,
              buildId: config.workerBuildId,
            },
            useWorkerVersioning: true,
            defaultVersioningBehavior: VersioningBehavior.PINNED,
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
