import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const queueMock = vi.hoisted(() => ({
  getJob: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  projectVideoGroup: {
    updateMany: vi.fn(),
  },
  projectEditStylePreview: {
    updateMany: vi.fn(),
  },
}))

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(),
}))

const billingMock = vi.hoisted(() => ({
  rollbackTaskBillingForTask: vi.fn(async () => ({
    attempted: false,
    rolledBack: true,
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/queues', () => ({ getAllQueues: () => [queueMock] }))
vi.mock('@/lib/task/publisher', () => publisherMock)
vi.mock('@/lib/task/service', () => billingMock)

import { reconcileActiveTasks } from '@/lib/task/reconcile'

describe('task reconcile target sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        userId: 'user-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        type: TASK_TYPE.VIDEO_GROUP,
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        billingInfo: null,
        updatedAt: new Date('2026-05-20T10:00:00.000Z'),
      },
    ])
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.projectVideoGroup.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.projectEditStylePreview.updateMany.mockResolvedValue({ count: 1 })
    queueMock.getJob.mockResolvedValue({
      getState: async () => 'failed',
    })
  })

  it('marks video group failed when orphan reconciliation fails its task', async () => {
    const reconciled = await reconcileActiveTasks()

    expect(reconciled).toEqual(['task-1'])
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'task-1',
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      data: expect.objectContaining({
        status: TASK_STATUS.FAILED,
        errorCode: 'RECONCILE_ORPHAN',
        errorMessage: 'Queue job already terminated but DB was not updated',
        dedupeKey: null,
      }),
    }))
    expect(prismaMock.projectVideoGroup.updateMany).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: {
        status: 'failed',
        taskId: null,
        errorCode: 'RECONCILE_ORPHAN',
        errorMessage: 'Queue job already terminated but DB was not updated',
      },
    })
  })

  it('marks edit style preview failed when orphan reconciliation fails its image task', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-style-1',
        userId: 'user-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
        targetType: 'ProjectEditStylePreview',
        targetId: 'style-preview-1',
        billingInfo: null,
        updatedAt: new Date('2026-05-20T10:00:00.000Z'),
      },
    ])

    const reconciled = await reconcileActiveTasks()

    expect(reconciled).toEqual(['task-style-1'])
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'task-style-1',
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      data: expect.objectContaining({
        status: TASK_STATUS.FAILED,
        errorCode: 'RECONCILE_ORPHAN',
        errorMessage: 'Queue job already terminated but DB was not updated',
        dedupeKey: null,
      }),
    }))
    expect(prismaMock.projectEditStylePreview.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'style-preview-1',
        status: { in: ['pending', 'generating'] },
      },
      data: {
        status: 'failed',
        errorMessage: 'Queue job already terminated but DB was not updated',
      },
    })
  })
})
