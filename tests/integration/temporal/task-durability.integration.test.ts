import { setTimeout as sleep } from 'node:timers/promises'
import type { WorkflowHandle } from '@temporalio/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTemporalClient } from '@/lib/temporal/client'
import {
  buildTaskWorkflowId,
  buildUserTaskSchedulerWorkflowId,
} from '@/lib/temporal/identity'
import { TemporalTaskClient } from '@/lib/temporal/task-client'
import type { TaskWorkflowInput, TaskWorkflowResult } from '@/lib/temporal/task/contracts'
import { TASK_EVENT_TYPE, TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { prisma } from '../../helpers/prisma'
import {
  activityAttempts,
  startTaskLateCancelWorker,
  startTaskProductionWorker,
  startTaskQueuedCancelWorker,
  startTaskDurabilityWorker,
  type TaskLateCancelWorkerHarness,
  type TaskProductionWorkerHarness,
  type TaskQueuedCancelWorkerHarness,
  type TaskDurabilityWorkerHarness,
} from './helpers/task-durability-harness'
import {
  createTaskLateCancelFixture,
  createTaskDurabilityFixture,
  createTaskWorkerKillFixture,
  removeTaskLateCancelFixture,
  removeTaskDurabilityFixture,
  removeTaskWorkerKillFixture,
} from './helpers/task-durability-fixture'
import {
  startTaskDurabilityChildWorker,
  type TaskDurabilityChildWorker,
} from './helpers/task-durability-worker-process'

/**
 * Admission record:
 * - TG-03 critical infrastructure: real Temporal Server, production Task and
 *   Scheduler Workflows, production Activities and real MySQL transactions.
 * - Independent oracle: MySQL terminal/Event/Batch/Turn uniqueness and
 *   Temporal Activity-attempt history.
 * - Rejects terminal rewrites after commit/ACK loss, capacity held by a
 *   blocked notification, late cancellation after a committed handler result,
 *   and duplicate follow-up Turns after notify ACK loss.
 * - The only faults are wrappers that delegate to the production Activity and
 *   discard its first acknowledgement after the production commit.
 */

let worker: TaskDurabilityWorkerHarness | null = null

function requireWorker(): TaskDurabilityWorkerHarness {
  if (!worker) throw new Error('TASK_DURABILITY_WORKER_MISSING')
  return worker
}

async function waitForTaskTerminal(taskId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    })
    if (
      task?.status === TASK_STATUS.COMPLETED ||
      task?.status === TASK_STATUS.FAILED ||
      task?.status === TASK_STATUS.CANCELED
    ) {
      return
    }
    await sleep(25)
  }
  throw new Error(`TASK_DURABILITY_TERMINAL_TIMEOUT:${taskId}`)
}

async function terminateQuietly(handle: WorkflowHandle | null, reason: string): Promise<void> {
  if (!handle) return
  try {
    await handle.terminate(reason)
  } catch {
    // A completed Workflow needs no cleanup.
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

describe('Temporal Task terminal and follow-up durability', () => {
  beforeAll(() => {
    if (process.env.TEMPORAL_TEST_BOOTSTRAP !== '1') {
      throw new Error('TASK_TEMPORAL_TEST_BOOTSTRAP_REQUIRED')
    }
  })

  afterAll(async () => {
    await worker?.close()
    worker = null
  }, 60_000)

  it('replays terminal and notification commits exactly once while notification cannot hold capacity', async () => {
    const fixture = await createTaskDurabilityFixture()
    const connected = await connectTemporalClient()
    const firstWorkflowId = buildTaskWorkflowId(fixture.firstTaskId)
    const secondWorkflowId = buildTaskWorkflowId(fixture.secondTaskId)
    const schedulerWorkflowId = buildUserTaskSchedulerWorkflowId(fixture.userId)
    let schedulerHandle: WorkflowHandle | null = null
    try {
      worker = await startTaskDurabilityWorker({
        faultTaskId: fixture.firstTaskId,
        faultBatchId: fixture.batchId,
      })
      const taskClient = new TemporalTaskClient(
        connected.client.workflow,
        requireWorker().taskQueue,
      )
      const firstHandle =
        connected.client.workflow.getHandle<
          (input: TaskWorkflowInput) => Promise<TaskWorkflowResult>
        >(firstWorkflowId)
      const secondHandle =
        connected.client.workflow.getHandle<
          (input: TaskWorkflowInput) => Promise<TaskWorkflowResult>
        >(secondWorkflowId)
      schedulerHandle = connected.client.workflow.getHandle(schedulerWorkflowId)

      await taskClient.schedule({
        taskId: fixture.firstTaskId,
        userId: fixture.userId,
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      })
      const firstTerminalReceipt = await requireWorker().waitForTerminalPostCommitFault()
      const firstCommittedTask = await prisma.task.findUniqueOrThrow({
        where: { id: fixture.firstTaskId },
        select: {
          status: true,
          attempt: true,
          failure: true,
          updatedAt: true,
        },
      })
      await requireWorker().waitForFollowUpNotificationBlocked()

      const batchBeforeNotification = await prisma.followUpBatch.findUniqueOrThrow({
        where: { id: fixture.batchId },
        select: {
          status: true,
          readyByTaskId: true,
          readyByTerminalEventId: true,
          notifiedTurnId: true,
        },
      })
      expect(batchBeforeNotification).toEqual({
        status: 'ready',
        readyByTaskId: fixture.firstTaskId,
        readyByTerminalEventId: firstTerminalReceipt.terminalEventId,
        notifiedTurnId: null,
      })

      await taskClient.schedule({
        taskId: fixture.secondTaskId,
        userId: fixture.userId,
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      })
      await waitForTaskTerminal(fixture.secondTaskId)
      const secondWhileNotificationBlocked = await prisma.task.findUniqueOrThrow({
        where: { id: fixture.secondTaskId },
        select: { status: true, attempt: true },
      })
      expect(secondWhileNotificationBlocked).toEqual({
        status: TASK_STATUS.FAILED,
        attempt: 1,
      })

      requireWorker().releaseFollowUpNotification()
      await requireWorker().waitForFollowUpPostCommitFault()
      const [firstResult, secondResult] = await Promise.all([
        firstHandle.result(),
        secondHandle.result(),
      ])
      expect(firstResult).toMatchObject({
        taskId: fixture.firstTaskId,
        status: 'failed',
        attempts: 1,
      })
      expect(secondResult).toMatchObject({
        taskId: fixture.secondTaskId,
        status: 'failed',
        attempts: 1,
      })

      const [
        firstFinalTask,
        firstTerminalEvents,
        batchAfterNotification,
        followUpTurns,
        firstHistory,
      ] = await Promise.all([
        prisma.task.findUniqueOrThrow({
          where: { id: fixture.firstTaskId },
          select: {
            status: true,
            attempt: true,
            failure: true,
            updatedAt: true,
          },
        }),
        prisma.taskEvent.findMany({
          where: {
            taskId: fixture.firstTaskId,
            eventType: TASK_EVENT_TYPE.FAILED,
          },
          select: { id: true },
        }),
        prisma.followUpBatch.findUniqueOrThrow({
          where: { id: fixture.batchId },
          select: {
            status: true,
            notifiedTurnId: true,
            readyByTerminalEventId: true,
          },
        }),
        prisma.projectAgentTurn.findMany({
          where: {
            threadId: fixture.threadId,
            sourceKind: 'task_follow_up',
            sourceId: fixture.batchId,
          },
          select: {
            id: true,
            sourceId: true,
          },
        }),
        firstHandle.fetchHistory(),
      ])

      expect(firstFinalTask).toEqual(firstCommittedTask)
      expect(firstFinalTask.failure).toMatchObject({
        version: 2,
        native: {
          message: 'Deterministic terminal fixture failure',
          code: 'PROVIDER_SUBMISSION_REJECTED',
        },
        interpretation: {
          code: 'PROVIDER_SUBMISSION_REJECTED',
          details: { reasonCode: 'TASK_DURABILITY_EXPECTED_FINAL' },
        },
        context: {
          system: 'provider',
          provider: 'temporal-test-provider',
          phase: 'submit',
        },
        recovery: { operation: null, taskReplay: 'forbidden' },
      })
      expect(firstTerminalEvents).toEqual([{ id: firstTerminalReceipt.terminalEventId }])
      expect(followUpTurns).toHaveLength(1)
      expect(batchAfterNotification).toEqual({
        status: 'notified',
        notifiedTurnId: followUpTurns[0]?.id ?? null,
        readyByTerminalEventId: firstTerminalReceipt.terminalEventId,
      })
      expect(
        Math.max(0, ...activityAttempts(firstHistory, 'commitTaskTerminal')),
      ).toBeGreaterThanOrEqual(2)
      expect(
        Math.max(0, ...activityAttempts(firstHistory, 'notifyTaskFollowUp')),
      ).toBeGreaterThanOrEqual(2)
    } finally {
      requireWorker().releaseFollowUpNotification()
      await terminateQuietly(schedulerHandle, 'TASK_DURABILITY_SCHEDULER_TEST_COMPLETE')
      await worker?.close()
      worker = null
      await connected.close()
      await removeTaskDurabilityFixture(fixture)
    }
  }, 60_000)

  it('cancels a queued Task durably without ever starting its TaskWorkflow', async () => {
    const fixture = await createTaskDurabilityFixture()
    const connected = await connectTemporalClient()
    const schedulerWorkflowId = buildUserTaskSchedulerWorkflowId(fixture.userId)
    const firstWorkflowId = buildTaskWorkflowId(fixture.firstTaskId)
    const secondWorkflowId = buildTaskWorkflowId(fixture.secondTaskId)
    let queuedCancelWorker: TaskQueuedCancelWorkerHarness | null = null
    let schedulerHandle: WorkflowHandle | null = null
    let firstHandle: WorkflowHandle | null = null
    try {
      queuedCancelWorker = await startTaskQueuedCancelWorker({
        capacityHolderTaskId: fixture.firstTaskId,
      })
      const taskClient = new TemporalTaskClient(
        connected.client.workflow,
        queuedCancelWorker.taskQueue,
      )
      schedulerHandle = connected.client.workflow.getHandle(schedulerWorkflowId)
      firstHandle = connected.client.workflow.getHandle(firstWorkflowId)

      await taskClient.schedule({
        taskId: fixture.firstTaskId,
        userId: fixture.userId,
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      })
      await queuedCancelWorker.waitForCapacityHeld()
      await taskClient.schedule({
        taskId: fixture.secondTaskId,
        userId: fixture.userId,
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      })

      const queuedTask = await prisma.task.findUniqueOrThrow({
        where: { id: fixture.secondTaskId },
        select: { status: true, attempt: true, startedAt: true },
      })
      expect(queuedTask).toEqual({
        status: TASK_STATUS.QUEUED,
        attempt: 0,
        startedAt: null,
      })

      const receipt = await taskClient.cancel({
        reference: {
          taskId: fixture.secondTaskId,
          userId: fixture.userId,
          taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
        },
        reason: 'TEST_CANCEL_WHILE_QUEUED',
      })
      expect(receipt).toEqual({
        taskId: fixture.secondTaskId,
        status: TASK_STATUS.CANCELED,
        cancelRequested: true,
      })

      const [canceledTask, canceledEvents] = await Promise.all([
        prisma.task.findUniqueOrThrow({
          where: { id: fixture.secondTaskId },
          select: { status: true, attempt: true, startedAt: true },
        }),
        prisma.taskEvent.findMany({
          where: {
            taskId: fixture.secondTaskId,
            eventType: TASK_EVENT_TYPE.CANCELED,
          },
          select: { id: true },
        }),
      ])
      expect(canceledTask).toEqual({
        status: TASK_STATUS.CANCELED,
        attempt: 0,
        startedAt: null,
      })
      expect(canceledEvents).toHaveLength(1)
      await expect(
        connected.client.workflow.getHandle(secondWorkflowId).describe(),
      ).rejects.toThrow()
    } finally {
      queuedCancelWorker?.releaseCapacityHolder()
      await terminateQuietly(firstHandle, 'TASK_QUEUED_CANCEL_CAPACITY_HOLDER_TEST_COMPLETE')
      await terminateQuietly(schedulerHandle, 'TASK_QUEUED_CANCEL_SCHEDULER_TEST_COMPLETE')
      await queuedCancelWorker?.close()
      await connected.close()
      await removeTaskDurabilityFixture(fixture)
    }
  }, 60_000)

  it('commits a durable handler result as completed when cancellation arrives before the Activity acknowledgement', async () => {
    const fixture = await createTaskLateCancelFixture()
    const connected = await connectTemporalClient()
    const workflowId = buildTaskWorkflowId(fixture.taskId)
    const schedulerWorkflowId = buildUserTaskSchedulerWorkflowId(fixture.userId)
    let lateCancelWorker: TaskLateCancelWorkerHarness | null = null
    let schedulerHandle: WorkflowHandle | null = null
    try {
      lateCancelWorker = await startTaskLateCancelWorker({
        taskId: fixture.taskId,
      })
      const taskClient = new TemporalTaskClient(
        connected.client.workflow,
        lateCancelWorker.taskQueue,
      )
      const handle =
        connected.client.workflow.getHandle<
          (input: TaskWorkflowInput) => Promise<TaskWorkflowResult>
        >(workflowId)
      schedulerHandle = connected.client.workflow.getHandle(schedulerWorkflowId)

      await taskClient.schedule({
        taskId: fixture.taskId,
        userId: fixture.userId,
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      })
      await lateCancelWorker.waitForHandlerCheckpointCommit()
      const cancelView = await taskClient.cancel({
        reference: {
          taskId: fixture.taskId,
          userId: fixture.userId,
          taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
        },
        reason: 'TEST_CANCEL_AFTER_HANDLER_CHECKPOINT_COMMIT',
      })
      expect(cancelView).toMatchObject({
        taskId: fixture.taskId,
        status: 'cancelling',
        cancelRequested: true,
      })
      await lateCancelWorker.waitForCancellationAcknowledged()

      const result = await within(handle.result(), 30_000, 'TASK_LATE_CANCEL_COMPLETION_TIMEOUT')
      expect(result).toMatchObject({
        taskId: fixture.taskId,
        status: 'completed',
        attempts: 1,
      })

      const [
        task,
        terminalEvents,
        checkpoint,
        freeze,
        refundTransactions,
        consumeTransactions,
        resource,
        history,
      ] = await Promise.all([
        prisma.task.findUniqueOrThrow({
          where: { id: fixture.taskId },
          select: {
            status: true,
            attempt: true,
            progress: true,
            failure: true,
            billingInfo: true,
          },
        }),
        prisma.taskEvent.findMany({
          where: {
            taskId: fixture.taskId,
            eventType: {
              in: [TASK_EVENT_TYPE.COMPLETED, TASK_EVENT_TYPE.CANCELED, TASK_EVENT_TYPE.FAILED],
            },
          },
          select: { id: true, eventType: true },
        }),
        prisma.taskExecutionCheckpoint.findUniqueOrThrow({
          where: { id: fixture.checkpointId },
          select: {
            id: true,
            stepKey: true,
            state: true,
          },
        }),
        prisma.balanceFreeze.findUniqueOrThrow({
          where: { id: fixture.freezeId },
          select: { status: true },
        }),
        prisma.balanceTransaction.count({
          where: {
            freezeId: fixture.freezeId,
            type: 'refund',
          },
        }),
        prisma.balanceTransaction.count({
          where: {
            freezeId: fixture.freezeId,
            type: 'consume',
          },
        }),
        prisma.workspaceResource.findUniqueOrThrow({
          where: { id: fixture.resourceId },
          select: {
            status: true,
            currentVersion: true,
            versions: {
              where: { version: 1 },
              select: { mediaId: true },
            },
          },
        }),
        handle.fetchHistory(),
      ])
      expect(task).toMatchObject({
        status: TASK_STATUS.COMPLETED,
        attempt: 1,
        progress: 100,
        failure: null,
        billingInfo: {
          status: 'settled',
          freezeId: fixture.freezeId,
        },
      })
      expect(terminalEvents).toHaveLength(1)
      expect(terminalEvents[0]?.eventType).toBe(TASK_EVENT_TYPE.COMPLETED)
      expect(checkpoint).toEqual({
        id: fixture.checkpointId,
        stepKey: '__handler_result__',
        state: 'ready',
      })
      expect(freeze.status).toBe('confirmed')
      expect(refundTransactions).toBe(0)
      expect(consumeTransactions).toBe(1)
      expect(resource).toEqual({
        status: 'ready',
        currentVersion: 1,
        versions: [{ mediaId: fixture.mediaObjectId }],
      })
      expect(activityAttempts(history, 'cancelTaskProviderJobs')).toHaveLength(0)
    } finally {
      await terminateQuietly(schedulerHandle, 'TASK_LATE_CANCEL_SCHEDULER_TEST_COMPLETE')
      await lateCancelWorker?.close()
      await connected.close()
      await removeTaskLateCancelFixture(fixture)
    }
  }, 60_000)

  it('recovers one business attempt from its durable checkpoint after the Worker process group is killed', async () => {
    const fixture = await createTaskWorkerKillFixture()
    const connected = await connectTemporalClient()
    const workflowId = buildTaskWorkflowId(fixture.taskId)
    const schedulerWorkflowId = buildUserTaskSchedulerWorkflowId(fixture.userId)
    const child: TaskDurabilityChildWorker = startTaskDurabilityChildWorker()
    let replacement: TaskProductionWorkerHarness | null = null
    let schedulerHandle: WorkflowHandle | null = null
    try {
      await child.waitUntilReady()
      const taskClient = new TemporalTaskClient(connected.client.workflow, child.taskQueue)
      const handle =
        connected.client.workflow.getHandle<
          (input: TaskWorkflowInput) => Promise<TaskWorkflowResult>
        >(workflowId)
      schedulerHandle = connected.client.workflow.getHandle(schedulerWorkflowId)
      const checkpointBeforeKill = await prisma.taskExecutionCheckpoint.findUniqueOrThrow({
        where: { id: fixture.checkpointId },
        select: {
          id: true,
          taskId: true,
          stepKey: true,
          inputFingerprint: true,
          output: true,
          updatedAt: true,
        },
      })

      await taskClient.schedule({
        taskId: fixture.taskId,
        userId: fixture.userId,
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      })
      await child.waitUntilRunResultBlocked()
      const taskAtKillBoundary = await prisma.task.findUniqueOrThrow({
        where: { id: fixture.taskId },
        select: {
          status: true,
          attempt: true,
          finishedAt: true,
        },
      })
      expect(taskAtKillBoundary).toEqual({
        status: TASK_STATUS.PROCESSING,
        attempt: 1,
        finishedAt: null,
      })

      await child.killProcessGroup()
      replacement = await startTaskProductionWorker()
      const result = await within(
        handle.result(),
        70_000,
        'TASK_DURABILITY_WORKER_KILL_RECOVERY_TIMEOUT',
      )
      expect(result).toMatchObject({
        taskId: fixture.taskId,
        status: 'failed',
        attempts: 1,
      })

      const [finalTask, finalCheckpoint, terminalEvents, history] = await Promise.all([
        prisma.task.findUniqueOrThrow({
          where: { id: fixture.taskId },
          select: {
            status: true,
            attempt: true,
          },
        }),
        prisma.taskExecutionCheckpoint.findUniqueOrThrow({
          where: { id: fixture.checkpointId },
          select: {
            id: true,
            taskId: true,
            stepKey: true,
            inputFingerprint: true,
            output: true,
            updatedAt: true,
          },
        }),
        prisma.taskEvent.findMany({
          where: {
            taskId: fixture.taskId,
            eventType: TASK_EVENT_TYPE.FAILED,
          },
          select: { id: true },
        }),
        handle.fetchHistory(),
      ])
      expect(finalTask).toEqual({
        status: TASK_STATUS.FAILED,
        attempt: 1,
      })
      expect(finalCheckpoint).toEqual(checkpointBeforeKill)
      expect(terminalEvents).toHaveLength(1)
      expect(Math.max(0, ...activityAttempts(history, 'runTaskAttempt'))).toBeGreaterThanOrEqual(2)
    } finally {
      await child.close()
      await terminateQuietly(schedulerHandle, 'TASK_DURABILITY_WORKER_KILL_SCHEDULER_TEST_COMPLETE')
      await replacement?.close()
      await connected.close()
      await removeTaskWorkerKillFixture(fixture)
    }
  }, 100_000)
})
