import { randomUUID } from 'node:crypto'
import type { NativeConnection, WorkerOptions } from '@temporalio/worker'
import { UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK } from '@/lib/temporal/workflow-registry'

const TEST_BUILD_ID = 'test'

export type TestWorkerScope =
  | 'operation-durability'
  | 'task-durability'

export function buildTestTaskQueue(
  taskQueue: string,
  scope: TestWorkerScope,
): string {
  return `${taskQueue}-${scope}`
}

function requireTestDeploymentName(): string {
  const value = process.env.TEMPORAL_WORKER_DEPLOYMENT_NAME?.trim()
  if (!value || !value.includes('test')) {
    throw new Error('TEMPORAL_TEST_WORKER_DEPLOYMENT_NAME_REQUIRED')
  }
  return value
}

function buildTestWorkerDeploymentName(scope: TestWorkerScope): string {
  return `${requireTestDeploymentName()}-${scope}`
}

export function buildTestWorkerDeploymentOptions(
  scope: TestWorkerScope,
): NonNullable<WorkerOptions['workerDeploymentOptions']> {
  return {
    version: {
      deploymentName: buildTestWorkerDeploymentName(scope),
      buildId: TEST_BUILD_ID,
    },
    useWorkerVersioning: true,
    defaultVersioningBehavior: UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK,
  }
}

export function buildTestWorkerIdentity(scope: TestWorkerScope): string {
  return `waoowaoo-${scope}-${randomUUID()}`
}

export async function activateTestWorkerVersion(
  connection: NativeConnection,
  namespace: string,
  taskQueue: string,
  workerIdentity: string,
  scope: TestWorkerScope,
): Promise<void> {
  const deploymentName = buildTestWorkerDeploymentName(scope)
  const deploymentVersion = {
    deploymentName,
    buildId: TEST_BUILD_ID,
  }
  let attempt = 1
  while (attempt <= 60) {
    try {
      const version = await connection.workflowService
        .describeWorkerDeploymentVersion({
          namespace,
          deploymentVersion,
        })
      if (!version.versionTaskQueues.some((queue) => queue.name === taskQueue)) {
        throw new Error('TEMPORAL_TEST_WORKER_TASK_QUEUE_NOT_REGISTERED')
      }
      const described = await connection.workflowService.describeWorkerDeployment({
        namespace,
        deploymentName,
      })
      await connection.workflowService.setWorkerDeploymentCurrentVersion({
        namespace,
        deploymentName,
        buildId: TEST_BUILD_ID,
        conflictToken: described.conflictToken,
        identity: 'waoowaoo-temporal-integration-tests',
      })
      break
    } catch (error: unknown) {
      if (attempt === 60) throw error
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, 100)
        timer.unref()
      })
      attempt += 1
    }
  }

  attempt = 1
  while (attempt <= 60) {
    const described = await connection.workflowService.describeWorkerDeployment({
      namespace,
      deploymentName,
    })
    const current = described.workerDeploymentInfo?.routingConfig
      ?.currentDeploymentVersion
    if (
      current?.deploymentName === deploymentName
      && current.buildId === TEST_BUILD_ID
      && described.workerDeploymentInfo?.routingConfigUpdateState === 2
    ) {
      return
    }
    if (attempt === 60) {
      throw new Error('TEMPORAL_TEST_WORKER_ROUTING_NOT_READY')
    }
    await new Promise<void>((resolveWait) => {
      const timer = setTimeout(resolveWait, 100)
      timer.unref()
    })
    attempt += 1
  }

  for (const taskQueueType of [1, 2] as const) {
    attempt = 1
    while (attempt <= 60) {
      const described = await connection.workflowService.describeTaskQueue({
        namespace,
        taskQueue: { name: taskQueue },
        taskQueueType,
      })
      if (described.pollers.some((poller) => poller.identity === workerIdentity)) {
        break
      }
      if (attempt === 60) {
        throw new Error('TEMPORAL_TEST_WORKER_POLLER_NOT_READY')
      }
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, 100)
        timer.unref()
      })
      attempt += 1
    }
  }
}
