import type { WorkflowHandle } from '@temporalio/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTemporalClient } from '@/lib/temporal/client'
import {
  buildOperationExecutionWorkflowId,
  buildTaskWorkflowId,
  buildUserTaskSchedulerWorkflowId,
} from '@/lib/temporal/identity'
import { TemporalOperationExecutionClient } from '@/lib/temporal/operation-execution/client'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import { prisma } from '../../helpers/prisma'
import { activityAttempts } from './helpers/task-durability-harness'
import {
  createOperationExecutionDurabilityFixture,
  removeOperationExecutionDurabilityFixture,
} from './helpers/operation-execution-durability-fixture'
import {
  startOperationExecutionDurabilityWorker,
  type OperationExecutionDurabilityWorker,
} from './helpers/operation-execution-durability-harness'

/**
 * Admission record:
 * - TG-03 critical infrastructure: real Temporal Server, the production
 *   OperationExecutionWorkflow, production Operation Activity and real MySQL.
 * - Independent oracle: one immutable OperationExecution, Task, Created
 *   TaskEvent and pending WorkspaceResource plus Temporal Activity attempts.
 * - Rejects rerunning a domain Operation after its transaction committed but
 *   the Activity acknowledgement was lost, and rejects payload reuse under
 *   the same execution identity.
 * - The only fault wrapper first completes the full production Activity and
 *   then discards its first acknowledgement.
 */

let worker: OperationExecutionDurabilityWorker | null = null

async function terminateQuietly(
  handle: WorkflowHandle | null,
  reason: string,
): Promise<void> {
  if (!handle) return
  try {
    await handle.terminate(reason)
  } catch {
    // A completed or already terminated Workflow needs no cleanup.
  }
}

describe('Temporal Operation execution durability', () => {
  beforeAll(() => {
    if (process.env.TEMPORAL_TEST_BOOTSTRAP !== '1') {
      throw new Error('OPERATION_TEMPORAL_TEST_BOOTSTRAP_REQUIRED')
    }
  })

  afterAll(async () => {
    await worker?.close()
    worker = null
  }, 60_000)

  it('replays a committed production Operation exactly once after Activity acknowledgement loss', async () => {
    const fixture = await createOperationExecutionDurabilityFixture()
    const connected = await connectTemporalClient()
    const workflowId = buildOperationExecutionWorkflowId(
      fixture.command.executionId,
    )
    let schedulerHandle: WorkflowHandle | null = null
    let taskHandle: WorkflowHandle | null = null
    try {
      worker = await startOperationExecutionDurabilityWorker({
        faultExecutionId: fixture.command.executionId,
      })
      const client = new TemporalOperationExecutionClient(
        connected.client.workflow,
        worker.taskQueue,
      )
      const firstExecution = client.execute(fixture.command)
      void firstExecution.catch(() => undefined)
      const firstCommittedReceipt =
        await worker.waitForPostCommitAcknowledgementLoss()
      const firstCommittedExecution =
        await prisma.operationExecution.findUniqueOrThrow({
          where: {
            id: firstCommittedReceipt.operationExecutionId,
          },
          select: {
            id: true,
            executionKind: true,
            commandId: true,
            payloadHash: true,
            contractRevision: true,
            normalizedInput: true,
            contextSnapshot: true,
            source: true,
            userId: true,
            projectId: true,
            operationId: true,
            requestId: true,
            status: true,
            output: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      const receipt = await firstExecution
      expect(receipt).toMatchObject({
        workflowId,
        commandId: firstCommittedReceipt.commandId,
        payloadHash: firstCommittedReceipt.payloadHash,
        executionId: fixture.command.executionId,
        operationExecutionId: firstCommittedReceipt.operationExecutionId,
        operationRequestId: fixture.command.operationRequestId,
        outputHash: firstCommittedReceipt.outputHash,
      })
      expect(receipt.tasks).toHaveLength(1)
      expect(firstCommittedReceipt.tasks).toHaveLength(1)
      expect(receipt.tasks[0]?.reference).toEqual(
        firstCommittedReceipt.tasks[0]?.reference,
      )

      const taskId = receipt.tasks[0]?.reference.taskId
      if (!taskId) {
        throw new Error('OPERATION_DURABILITY_TASK_ID_MISSING')
      }
      schedulerHandle = connected.client.workflow.getHandle(
        buildUserTaskSchedulerWorkflowId(fixture.userId),
      )
      taskHandle = connected.client.workflow.getHandle(
        buildTaskWorkflowId(taskId),
      )
      const operationHandle =
        connected.client.workflow.getHandle(workflowId)
      const replayReceipt = await client.execute(fixture.command)
      expect(replayReceipt).toEqual(receipt)

      const divergentCommand = {
        ...fixture.command,
        normalizedInput: {
          ...fixture.command.normalizedInput as Record<string, unknown>,
          name: 'Divergent operation payload',
        },
      }
      await expect(client.execute(divergentCommand)).rejects.toThrow(
        'OPERATION_EXECUTION_REPLAY_DIVERGED',
      )

      const [
        finalExecution,
        tasks,
        createdEvents,
        resources,
        history,
      ] = await Promise.all([
        prisma.operationExecution.findUniqueOrThrow({
          where: { id: receipt.operationExecutionId },
          select: {
            id: true,
            executionKind: true,
            commandId: true,
            payloadHash: true,
            contractRevision: true,
            normalizedInput: true,
            contextSnapshot: true,
            source: true,
            userId: true,
            projectId: true,
            operationId: true,
            requestId: true,
            status: true,
            output: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.task.findMany({
          where: { operationExecutionId: receipt.operationExecutionId },
          select: {
            id: true,
            targetId: true,
            operationExecutionId: true,
            operationId: true,
            operationRequestId: true,
            userId: true,
            projectId: true,
          },
        }),
        prisma.taskEvent.findMany({
          where: {
            taskId,
            eventType: TASK_EVENT_TYPE.CREATED,
          },
          select: {
            id: true,
            idempotencyKey: true,
          },
        }),
        prisma.workspaceResource.findMany({
          where: { operationExecutionId: receipt.operationExecutionId },
          select: {
            id: true,
            taskId: true,
            operationExecutionId: true,
            status: true,
          },
        }),
        operationHandle.fetchHistory(),
      ])

      expect(finalExecution).toEqual(firstCommittedExecution)
      expect(tasks).toEqual([
        {
          id: taskId,
          targetId: expect.any(String),
          operationExecutionId: receipt.operationExecutionId,
          operationId: fixture.command.operationId,
          operationRequestId: fixture.command.operationRequestId,
          userId: fixture.userId,
          projectId: fixture.projectId,
        },
      ])
      expect(createdEvents).toEqual([
        {
          id: expect.any(Number),
          idempotencyKey: `task-created:${taskId}`,
        },
      ])
      expect(resources).toEqual([
        {
          id: tasks[0]?.targetId,
          taskId,
          operationExecutionId: receipt.operationExecutionId,
          status: 'pending',
        },
      ])
      expect(
        Math.max(0, ...activityAttempts(history, 'executeOperation')),
      ).toBeGreaterThanOrEqual(2)
    } finally {
      await terminateQuietly(
        taskHandle,
        'OPERATION_DURABILITY_TASK_TEST_COMPLETE',
      )
      await terminateQuietly(
        schedulerHandle,
        'OPERATION_DURABILITY_SCHEDULER_TEST_COMPLETE',
      )
      await worker?.close()
      worker = null
      await connected.close()
      await removeOperationExecutionDurabilityFixture(fixture)
    }
  }, 60_000)

  it('round-trips a typed workspace path failure through real Temporal wrappers', async () => {
    const fixture = await createOperationExecutionDurabilityFixture()
    const connected = await connectTemporalClient()
    const command = {
      ...fixture.command,
      executionId: `${fixture.command.executionId}-missing-folder`,
      operationRequestId: `${fixture.command.operationRequestId}-missing-folder`,
      normalizedInput: {
        ...fixture.command.normalizedInput as Record<string, unknown>,
        folderPath: '../成片',
      },
    }
    try {
      worker = await startOperationExecutionDurabilityWorker({
        faultExecutionId: 'no-ack-loss-for-missing-folder',
      })
      const client = new TemporalOperationExecutionClient(
        connected.client.workflow,
        worker.taskQueue,
      )

      await expect(client.execute(command)).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
        failure: {
          version: 2,
          interpretation: {
            code: 'INVALID_PARAMS',
            details: {
              reasonCode: 'WORKSPACE_RESOURCE_PATH_INVALID',
            },
          },
          context: { system: 'application' },
          native: { message: expect.any(String) },
        },
      })
      await expect(prisma.task.count({
        where: { operationRequestId: command.operationRequestId },
      })).resolves.toBe(0)
      await expect(prisma.workspaceResource.count({
        where: { projectId: fixture.projectId, operationExecutionId: command.executionId },
      })).resolves.toBe(0)
    } finally {
      await worker?.close()
      worker = null
      await connected.close()
      await removeOperationExecutionDurabilityFixture(fixture)
    }
  }, 60_000)
})
