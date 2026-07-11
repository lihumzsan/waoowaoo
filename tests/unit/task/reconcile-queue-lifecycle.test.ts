import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const queueMock = vi.hoisted(() => ({
  getJob: vi.fn(),
}))

const queuesMock = vi.hoisted(() => ({
  addTaskJob: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const serviceMock = vi.hoisted(() => ({
  markTaskEnqueueFailed: vi.fn(),
  markTaskEnqueued: vi.fn(),
  rollbackTaskBillingForTask: vi.fn(async () => ({
    attempted: false,
    rolledBack: true,
  })),
  sweepStaleTasks: vi.fn(async () => []),
}))

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(),
}))

const terminalMock = vi.hoisted(() => ({
  commitTaskTerminal: vi.fn(async (): Promise<Record<string, unknown>> => ({
    applied: true as const,
    status: 'failed' as const,
    terminalEventId: 1,
    outboxCommandIds: [],
  })),
}))
const approvedEnqueueMock = vi.hoisted(() => ({
  enqueuePersistedTask: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/queues', () => ({
  getAllQueues: () => [queueMock],
  addTaskJob: queuesMock.addTaskJob,
}))
vi.mock('@/lib/task/service', () => serviceMock)
vi.mock('@/lib/task/publisher', () => publisherMock)
vi.mock('@/lib/task/terminal', () => terminalMock)
vi.mock('@/lib/task/enqueue', () => approvedEnqueueMock)

import { reconcileActiveTasks, runTaskReconciliationCycle } from '@/lib/task/reconcile'

function buildQueuedTask(
  payload: unknown = {
    groupId: 'group-1',
    meta: {
      locale: 'zh',
      trace: { requestId: 'request-1' },
    },
  },
) {
  return {
    id: 'task-1',
    parentTaskId: 'parent-task-1',
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    type: TASK_TYPE.VIDEO_GROUP,
    targetType: 'ProjectVideoGroup',
    targetId: 'group-1',
    status: TASK_STATUS.QUEUED,
    payload,
    batchKey: 'batch-1',
    billingInfo: null,
    priority: 7,
    operationId: 'generate_video_group',
    operationSource: 'assistant',
    approvalGrantId: null,
    operationExecutionId: null,
    operationPlanTaskId: null,
    operationRequestId: 'operation-request-1',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

describe('task reconcile queue lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([buildQueuedTask()])
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    queueMock.getJob.mockResolvedValue(null)
    queuesMock.addTaskJob.mockResolvedValue(undefined)
    serviceMock.sweepStaleTasks.mockResolvedValue([])
  })

  it('re-enqueues an absent queued job with the complete durable envelope', async () => {
    const result = await reconcileActiveTasks()

    expect(result).toEqual({
      failedTaskIds: [],
      recoveredTaskIds: ['task-1'],
      unavailableTaskIds: [],
    })
    expect(queuesMock.addTaskJob).toHaveBeenCalledWith(
      {
        taskId: 'task-1',
        parentTaskId: 'parent-task-1',
        type: TASK_TYPE.VIDEO_GROUP,
        locale: 'zh',
        projectId: 'project-1',
        episodeId: 'episode-1',
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        payload: {
          groupId: 'group-1',
          meta: {
            locale: 'zh',
            trace: { requestId: 'request-1' },
          },
        },
        batchKey: 'batch-1',
        billingInfo: null,
        userId: 'user-1',
        operationId: 'generate_video_group',
        operationSource: 'assistant',
        approvalGrantId: null,
        operationExecutionId: null,
        operationPlanTaskId: null,
        operationRequestId: 'operation-request-1',
        trace: { requestId: 'request-1' },
      },
      { priority: 7 },
    )
    expect(serviceMock.markTaskEnqueued).toHaveBeenCalledWith('task-1')
  })

  it('recovers an approved queued task only through the completed execution gate', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        ...buildQueuedTask(),
        approvalGrantId: 'grant-1',
        operationExecutionId: 'execution-1',
        operationPlanTaskId: 'plan-task-1',
      },
    ])

    const result = await reconcileActiveTasks()

    expect(result.recoveredTaskIds).toEqual(['task-1'])
    expect(approvedEnqueueMock.enqueuePersistedTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      operationExecutionId: 'execution-1',
    })
    expect(queuesMock.addTaskJob).not.toHaveBeenCalled()
    expect(serviceMock.markTaskEnqueued).not.toHaveBeenCalled()
  })

  it('records BullMQ failedReason when a terminal job missed its Task handoff', async () => {
    queueMock.getJob.mockResolvedValue({
      getState: vi.fn(async () => 'failed'),
      failedReason: 'provider request exhausted',
    })

    const result = await reconcileActiveTasks()

    expect(result.failedTaskIds).toEqual(['task-1'])
    expect(terminalMock.commitTaskTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'failed',
        taskId: 'task-1',
        fence: {
          kind: 'snapshot',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        source: 'reconciler',
        errorCode: 'RECONCILE_ORPHAN',
        errorMessage: 'Queue job failed before Task terminal update: provider request exhausted',
      }),
    )
  })

  it('requeues the same Task when formal resource success won the terminal race', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        ...buildQueuedTask(),
        status: TASK_STATUS.PROCESSING,
      },
    ])
    queueMock.getJob.mockResolvedValue({
      getState: vi.fn(async () => 'failed'),
      failedReason: 'worker stopped after persisting the resource',
    })
    terminalMock.commitTaskTerminal.mockResolvedValueOnce({
      applied: false,
      reason: 'completion_pending',
      existingStatus: TASK_STATUS.PROCESSING,
      terminalEventId: null,
      outboxCommandIds: [],
    })

    const result = await reconcileActiveTasks()

    expect(result).toEqual({
      failedTaskIds: [],
      recoveredTaskIds: ['task-1'],
      unavailableTaskIds: [],
    })
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: TASK_STATUS.PROCESSING,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: {
        status: TASK_STATUS.QUEUED,
        startedAt: null,
        heartbeatAt: null,
      },
    })
    expect(queuesMock.addTaskJob).toHaveBeenCalledTimes(1)
  })

  it('reports an invalid recovery envelope as failed rather than recovered', async () => {
    prismaMock.task.findMany.mockResolvedValue([buildQueuedTask({ groupId: 'group-1' })])

    const result = await reconcileActiveTasks()

    expect(result).toEqual({
      failedTaskIds: ['task-1'],
      recoveredTaskIds: [],
      unavailableTaskIds: [],
    })
    expect(queuesMock.addTaskJob).not.toHaveBeenCalled()
    expect(terminalMock.commitTaskTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'failed',
        taskId: 'task-1',
        source: 'reconciler',
        errorMessage: 'Queued task recovery contract invalid: task locale is missing',
      }),
    )
  })

  it('coalesces overlapping reconciliation ticks into one cycle', async () => {
    let releaseSweep: () => void = () => {
      throw new Error('sweep release was not initialized')
    }
    serviceMock.sweepStaleTasks.mockImplementationOnce(
      async () =>
        await new Promise<[]>((resolve) => {
          releaseSweep = () => resolve([])
        }),
    )

    const first = runTaskReconciliationCycle()
    const second = runTaskReconciliationCycle()

    expect(second).toBe(first)
    expect(serviceMock.sweepStaleTasks).toHaveBeenCalledTimes(1)
    releaseSweep()
    await Promise.all([first, second])
    expect(prismaMock.task.findMany).toHaveBeenCalledTimes(1)
  })
})
