import type { NativeConnection, WorkerOptions } from '@temporalio/worker'
import { UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK } from '@/lib/temporal/workflow-registry'

const TEST_BUILD_ID = 'test'

function requireTestDeploymentName(): string {
  const value = process.env.TEMPORAL_WORKER_DEPLOYMENT_NAME?.trim()
  if (!value || !value.includes('test')) {
    throw new Error('TEMPORAL_TEST_WORKER_DEPLOYMENT_NAME_REQUIRED')
  }
  return value
}

export const TEST_WORKER_DEPLOYMENT_NAME = requireTestDeploymentName()

export const TEST_WORKER_DEPLOYMENT_OPTIONS = {
  version: {
    deploymentName: TEST_WORKER_DEPLOYMENT_NAME,
    buildId: TEST_BUILD_ID,
  },
  useWorkerVersioning: true,
  defaultVersioningBehavior: UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK,
} as const satisfies WorkerOptions['workerDeploymentOptions']

export async function activateTestWorkerVersion(
  connection: NativeConnection,
  namespace: string,
): Promise<void> {
  let attempt = 1
  while (attempt <= 60) {
    try {
      const described = await connection.workflowService.describeWorkerDeployment({
        namespace,
        deploymentName: TEST_WORKER_DEPLOYMENT_NAME,
      })
      await connection.workflowService.setWorkerDeploymentCurrentVersion({
        namespace,
        deploymentName: TEST_WORKER_DEPLOYMENT_NAME,
        buildId: TEST_BUILD_ID,
        conflictToken: described.conflictToken,
        identity: 'waoowaoo-temporal-integration-tests',
      })
      return
    } catch (error: unknown) {
      if (attempt === 60) throw error
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, 100)
        timer.unref()
      })
      attempt += 1
    }
  }
}
