import {
  WithStartWorkflowOperation,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type WorkflowHandle,
} from '@temporalio/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { connectTemporalClient } from '@/lib/temporal/client'
import { buildTaskWorkflowId, buildUserTaskSchedulerWorkflowId } from '@/lib/temporal/identity'
import {
  USER_TASK_SCHEDULER_UPDATE_NAME,
  type ScheduledTaskRequest,
  type UserTaskSchedulerView,
} from '@/lib/temporal/task/contracts'
import { TEMPORAL_WORKFLOW } from '@/lib/temporal/workflow-registry'
import { TASK_EVENT_TYPE, TASK_STATUS } from '@/lib/task/types'
import { prisma } from '../../helpers/prisma'
import {
  createTaskDependencyGateFixture,
  removeTaskDependencyGateFixture,
  seedTaskDependencyGateDependentCheckpoint,
  type TaskDependencyGateFixture,
} from './helpers/task-dependency-gate-fixture'
import {
  startTaskDependencyGateWorker,
  type TaskDependencyGateWorkerHarness,
} from './helpers/task-durability-harness'
import { activityAttempts } from './helpers/task-durability-harness'

let activeWorker: TaskDependencyGateWorkerHarness | null = null
let activeFixture: TaskDependencyGateFixture | null = null

type UserTaskSchedulerWorkflow = (input: {
  readonly workflowId: string
  readonly userId: string
  readonly slotLimits: { readonly analysis: number; readonly image: number; readonly video: number }
}) => Promise<UserTaskSchedulerView>

async function scheduleRawRequest(
  taskQueue: string,
  request: ScheduledTaskRequest,
): Promise<unknown> {
  const connected = await connectTemporalClient()
  try {
    const startOperation = new WithStartWorkflowOperation<UserTaskSchedulerWorkflow>(
      TEMPORAL_WORKFLOW.USER_TASK_SCHEDULER.type,
      {
        workflowId: request.task.schedulerWorkflowId,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        taskQueue,
        args: [{
          workflowId: request.task.schedulerWorkflowId,
          userId: request.task.userId,
          slotLimits: { analysis: 1, image: 1, video: 1 },
        }],
      },
    )
    return await connected.client.workflow.executeUpdateWithStart<
      UserTaskSchedulerWorkflow,
      unknown,
      [ScheduledTaskRequest]
    >(USER_TASK_SCHEDULER_UPDATE_NAME.ENQUEUE, {
      updateId: `terminal-admission-noncanonical:${request.task.taskId}`,
      args: [request],
      startWorkflowOperation: startOperation,
    })
  } finally {
    await connected.close()
  }
}

async function terminateScheduler(userId: string): Promise<void> {
  const connected = await connectTemporalClient()
  try {
    const handle: WorkflowHandle = connected.client.workflow.getHandle(
      buildUserTaskSchedulerWorkflowId(userId),
    )
    try {
      await handle.terminate('TASK_DEPENDENCY_GATE_TEST_COMPLETE')
    } catch {
      // Completed Scheduler workflows need no cleanup.
    }
  } finally {
    await connected.close()
  }
}

async function cleanup(): Promise<void> {
  await activeWorker?.close()
  activeWorker = null
  if (activeFixture) {
    await terminateScheduler(activeFixture.userId)
    await removeTaskDependencyGateFixture(activeFixture)
    activeFixture = null
  }
}

async function expectTaskWorkflowAbsent(taskId: string): Promise<void> {
  const connected = await connectTemporalClient()
  try {
    await expect(
      connected.client.workflow.getHandle(buildTaskWorkflowId(taskId)).describe(),
    ).rejects.toThrow()
  } finally {
    await connected.close()
  }
}

function hasNonRetryableTopologyFailure(error: unknown): boolean {
  let current: unknown = error
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 12; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) return false
    seen.add(current)
    const record = current as Record<string, unknown>
    if (
      record.nonRetryable === true
      && typeof record.message === 'string'
      && record.message.includes('TASK_DEPENDENCY_TOPOLOGY_DIVERGED')
    ) {
      return true
    }
    current = record.cause
  }
  return false
}

describe('Temporal dependency gate durability', () => {
  beforeAll(() => {
    if (process.env.TEMPORAL_TEST_BOOTSTRAP !== '1') {
      throw new Error('TASK_TEMPORAL_TEST_BOOTSTRAP_REQUIRED')
    }
  })

  afterEach(async () => {
    await cleanup()
  })

  it('keeps dependent queued until every required source completes and capacity is released', async () => {
    activeFixture = await createTaskDependencyGateFixture({
      suffix: 'success',
      sourceOutcomes: ['completed', 'completed'],
    })
    await seedTaskDependencyGateDependentCheckpoint(activeFixture)
    activeWorker = await startTaskDependencyGateWorker({
      heldSourceTaskId: activeFixture.source2TaskId,
      faultAfterTerminalTaskId: null,
    })
    await activeWorker.taskClient.schedule(activeFixture.references.mix)
    await activeWorker.taskClient.schedule(activeFixture.references.source1)
    await activeWorker.taskClient.schedule(activeFixture.references.source2)
    await activeWorker.waitForTaskStatus(activeFixture.source1TaskId, 'completed')
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: activeFixture.mixTaskId }, select: { status: true, attempt: true } }),
    ).resolves.toEqual({ status: TASK_STATUS.QUEUED, attempt: 0 })
    await expect(activeWorker.queryScheduler(activeFixture.userId)).resolves.toMatchObject({
      capacityActiveTaskWorkflowIds: expect.not.arrayContaining([buildTaskWorkflowId(activeFixture.mixTaskId)]),
    })
    activeWorker.releaseHeldSource()
    await activeWorker.waitForTaskStatus(activeFixture.mixTaskId, 'completed')
    const mixHistory = await activeWorker.fetchTaskHistory(activeFixture.mixTaskId)
    expect(activityAttempts(mixHistory, 'runTaskAttempt').length).toBeGreaterThanOrEqual(1)
    expect(activityAttempts(mixHistory, 'commitTaskTerminal').length).toBeGreaterThanOrEqual(1)
    await expect(
      prisma.taskEvent.count({ where: { taskId: activeFixture.mixTaskId, eventType: TASK_EVENT_TYPE.COMPLETED } }),
    ).resolves.toBe(1)
  }, 90_000)

  it('cancels a dependent through terminal writer and readies FollowUpBatch exactly once', async () => {
    activeFixture = await createTaskDependencyGateFixture({
      suffix: 'failure',
      sourceOutcomes: ['completed', 'failed'],
    })
    activeWorker = await startTaskDependencyGateWorker({ heldSourceTaskId: null, faultAfterTerminalTaskId: null })
    await activeWorker.taskClient.schedule(activeFixture.references.mix)
    await activeWorker.taskClient.schedule(activeFixture.references.source1)
    await activeWorker.taskClient.schedule(activeFixture.references.source2)
    await activeWorker.waitForTaskStatus(activeFixture.mixTaskId, 'canceled')
    await expectTaskWorkflowAbsent(activeFixture.mixTaskId)
    const terminalEvents = await prisma.taskEvent.findMany({
      where: { taskId: activeFixture.mixTaskId, eventType: TASK_EVENT_TYPE.CANCELED },
      select: { id: true, payload: true },
    })
    expect(terminalEvents).toHaveLength(1)
    expect(terminalEvents[0]?.payload).toMatchObject({ errorCode: 'TASK_DEPENDENCY_FAILED' })
    await expect(
      prisma.followUpBatch.findUniqueOrThrow({ where: { id: activeFixture.followUpBatchId }, select: { status: true } }),
    ).resolves.toEqual({ status: 'ready' })
    await expect(
      prisma.followUpBatchMember.findUniqueOrThrow({
        where: { batchId_taskId: { batchId: activeFixture.followUpBatchId, taskId: activeFixture.mixTaskId } },
        select: { status: true, terminalEventId: true },
      }),
    ).resolves.toEqual({ status: 'canceled', terminalEventId: terminalEvents[0]?.id })
  }, 90_000)

  it('replays a terminal ACK loss after Worker restart without duplicate terminal events', async () => {
    activeFixture = await createTaskDependencyGateFixture({ suffix: 'ack-loss', sourceOutcomes: ['completed', 'completed'] })
    await seedTaskDependencyGateDependentCheckpoint(activeFixture)
    activeWorker = await startTaskDependencyGateWorker({
      heldSourceTaskId: null,
      faultAfterTerminalTaskId: activeFixture.source1TaskId,
    })
    await activeWorker.taskClient.schedule(activeFixture.references.mix)
    await activeWorker.taskClient.schedule(activeFixture.references.source1)
    await activeWorker.taskClient.schedule(activeFixture.references.source2)
    await activeWorker.waitForTerminalPostCommitFault()
    await activeWorker.close()
    activeWorker = await startTaskDependencyGateWorker({ heldSourceTaskId: null, faultAfterTerminalTaskId: null })
    await activeWorker.waitForTaskStatus(activeFixture.mixTaskId, 'completed')
    const sourceHistory = await activeWorker.fetchTaskHistory(activeFixture.source1TaskId)
    const mixHistory = await activeWorker.fetchTaskHistory(activeFixture.mixTaskId)
    expect(activityAttempts(sourceHistory, 'commitTaskTerminal').length).toBeGreaterThanOrEqual(2)
    expect(activityAttempts(mixHistory, 'runTaskAttempt').length).toBeGreaterThanOrEqual(1)
    await expect(
      prisma.taskEvent.count({ where: { taskId: activeFixture.source1TaskId, eventType: TASK_EVENT_TYPE.COMPLETED } }),
    ).resolves.toBe(1)
    await expect(
      prisma.taskEvent.count({ where: { taskId: activeFixture.mixTaskId, eventType: TASK_EVENT_TYPE.COMPLETED } }),
    ).resolves.toBe(1)
    await expect(
      prisma.taskExecutionCheckpoint.count({ where: { taskId: activeFixture.mixTaskId, stepKey: '__handler_result__' } }),
    ).resolves.toBe(1)
  }, 120_000)

  it('cancels a waiting dependent through Scheduler and replays the same terminal receipt', async () => {
    activeFixture = await createTaskDependencyGateFixture({ suffix: 'cancel', sourceOutcomes: ['completed', 'completed'] })
    activeWorker = await startTaskDependencyGateWorker({ heldSourceTaskId: activeFixture.source1TaskId, faultAfterTerminalTaskId: null })
    await activeWorker.taskClient.schedule(activeFixture.references.mix)
    const first = await activeWorker.taskClient.cancel({
      reference: activeFixture.references.mix,
      reason: 'TASK_DEPENDENCY_GATE_TEST_CANCEL',
    })
    const replay = await activeWorker.taskClient.cancel({
      reference: activeFixture.references.mix,
      reason: 'TASK_DEPENDENCY_GATE_TEST_CANCEL',
    })
    expect(replay).toEqual(first)
    await activeWorker.waitForTaskStatus(activeFixture.mixTaskId, 'canceled')
    await expectTaskWorkflowAbsent(activeFixture.mixTaskId)
    await expect(activeWorker.queryScheduler(activeFixture.userId)).resolves.toMatchObject({
      capacityActiveTaskWorkflowIds: expect.not.arrayContaining([buildTaskWorkflowId(activeFixture.mixTaskId)]),
    })
    await expect(
      prisma.taskEvent.count({ where: { taskId: activeFixture.mixTaskId, eventType: TASK_EVENT_TYPE.CANCELED } }),
    ).resolves.toBe(1)
    await expect(
      prisma.taskExecutionCheckpoint.count({ where: { taskId: activeFixture.mixTaskId, stepKey: '__handler_result__' } }),
    ).resolves.toBe(0)
  }, 90_000)

  it('validates terminal admission topology before returning the existing receipt', async () => {
    activeFixture = await createTaskDependencyGateFixture({
      suffix: 'terminal-admission',
      sourceOutcomes: ['completed', 'completed'],
    })
    await seedTaskDependencyGateDependentCheckpoint(activeFixture)
    activeWorker = await startTaskDependencyGateWorker({
      heldSourceTaskId: null,
      faultAfterTerminalTaskId: null,
    })
    await activeWorker.taskClient.schedule(activeFixture.references.mix)
    await activeWorker.taskClient.schedule(activeFixture.references.source1)
    await activeWorker.taskClient.schedule(activeFixture.references.source2)
    await activeWorker.waitForTaskStatus(activeFixture.mixTaskId, 'completed')
    await terminateScheduler(activeFixture.userId)

    const canonicalTask = {
      workflowId: buildTaskWorkflowId(activeFixture.mixTaskId),
      schedulerWorkflowId: buildUserTaskSchedulerWorkflowId(activeFixture.userId),
      taskId: activeFixture.mixTaskId,
      userId: activeFixture.userId,
      taskType: activeFixture.references.mix.taskType,
    }
    let nonCanonicalEnqueue: unknown = null
    try {
      await scheduleRawRequest(activeWorker.taskQueue, {
        enqueueId: 'non-canonical-terminal-enqueue',
        task: canonicalTask,
        dependsOnTaskIds: [...activeFixture.references.mix.dependsOnTaskIds],
      })
    } catch (error) {
      nonCanonicalEnqueue = error
    }
    expect(hasNonRetryableTopologyFailure(nonCanonicalEnqueue)).toBe(true)

    const mismatchedReference = {
      ...activeFixture.references.mix,
      dependsOnTaskIds: [activeFixture.source1TaskId],
    }
    let mismatch: unknown = null
    try {
      await activeWorker.taskClient.schedule(mismatchedReference)
    } catch (error) {
      mismatch = error
    }
    expect(hasNonRetryableTopologyFailure(mismatch)).toBe(true)

    await expect(
      activeWorker.taskClient.schedule(activeFixture.references.mix),
    ).resolves.toMatchObject({
      taskWorkflowId: buildTaskWorkflowId(activeFixture.mixTaskId),
      state: 'completed',
    })
    await expect(
      prisma.taskEvent.count({
        where: {
          taskId: activeFixture.mixTaskId,
          eventType: TASK_EVENT_TYPE.COMPLETED,
        },
      }),
    ).resolves.toBe(1)
  }, 90_000)
})
