import type { WorkflowHandle } from '@temporalio/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { connectTemporalClient } from '@/lib/temporal/client'
import { buildTaskWorkflowId, buildUserTaskSchedulerWorkflowId } from '@/lib/temporal/identity'
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

let activeWorker: TaskDependencyGateWorkerHarness | null = null
let activeFixture: TaskDependencyGateFixture | null = null

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
    await expect(activeWorker.queryScheduler(activeFixture.userId)).resolves.toMatchObject({ status: 'RUNNING' })
    activeWorker.releaseHeldSource()
    await activeWorker.waitForTaskStatus(activeFixture.mixTaskId, 'completed')
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
    await expect(activeWorker.queryScheduler(activeFixture.userId)).resolves.toMatchObject({ status: 'RUNNING' })
    await expect(
      prisma.taskEvent.count({ where: { taskId: activeFixture.mixTaskId, eventType: TASK_EVENT_TYPE.CANCELED } }),
    ).resolves.toBe(1)
    await expect(
      prisma.taskExecutionCheckpoint.count({ where: { taskId: activeFixture.mixTaskId, stepKey: '__handler_result__' } }),
    ).resolves.toBe(1)
  }, 90_000)
})
