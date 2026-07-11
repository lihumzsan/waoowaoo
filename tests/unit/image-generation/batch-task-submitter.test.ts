import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(async () => [] as Array<{ id: string }>),
  submitTask: vi.fn(),
  cancelTask: vi.fn<(taskId: string, reason?: string) => Promise<{ cancelled: boolean }>>(async () => ({ cancelled: true })),
  removeTaskJob: vi.fn<(taskId: string) => Promise<boolean>>(async () => true),
}))

vi.mock('node:crypto', () => ({ randomUUID: () => 'batch-1' }))
vi.mock('@/lib/prisma', () => ({ prisma: { task: { findMany: mocks.findMany } } }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: mocks.submitTask }))
vi.mock('@/lib/task/service', () => ({ cancelTask: mocks.cancelTask }))
vi.mock('@/lib/task/queues', () => ({ removeTaskJob: mocks.removeTaskJob }))

import { submitImageBatchTasks } from '@/lib/image-generation/batch-task-submitter'

describe('submitImageBatchTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findMany.mockResolvedValue([])
    mocks.submitTask.mockImplementation(async (input: { payload: { imageIndex: number } }) => ({
      success: true,
      async: true,
      taskId: `task-${input.payload.imageIndex}`,
      status: 'queued',
      deduped: false,
    }))
  })

  it('submits one independently deduped child task per image index', async () => {
    const result = await submitImageBatchTasks({
      userId: 'user-1',
      locale: 'zh',
      requestId: 'request-1',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      targetType: 'LocationImage',
      targetId: 'location-1',
      payload: { count: 3, imageModel: 'codex::gpt-image-2' },
      count: 3,
    })

    expect(mocks.submitTask).toHaveBeenCalledTimes(3)
    for (let index = 0; index < 3; index += 1) {
      expect(mocks.submitTask).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        targetId: 'location-1',
        payload: expect.objectContaining({
          count: 1,
          imageIndex: index,
          batch: { id: 'batch-1', index, total: 3 },
        }),
        dedupeKey: `${TASK_TYPE.IMAGE_LOCATION}:location-1:single:${index}`,
      }))
    }
    expect(result).toEqual({
      success: true,
      async: true,
      taskId: 'task-0',
      taskIds: ['task-0', 'task-1', 'task-2'],
      batchId: 'batch-1',
      status: 'queued',
    })
  })

  it('cancels older active children before submitting a regeneration batch', async () => {
    const order: string[] = []
    mocks.findMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }])
    mocks.cancelTask.mockImplementation(async (taskId: string) => {
      order.push(`cancel:${taskId}`)
      return { cancelled: true }
    })
    mocks.removeTaskJob.mockImplementation(async (taskId: string) => {
      order.push(`remove:${taskId}`)
      return true
    })
    mocks.submitTask.mockImplementation(async (input: { payload: { imageIndex: number } }) => {
      order.push(`submit:${input.payload.imageIndex}`)
      return {
        success: true,
        async: true,
        taskId: `task-${input.payload.imageIndex}`,
        status: 'queued',
        deduped: false,
      }
    })

    await submitImageBatchTasks({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      payload: { count: 2 },
      count: 2,
      regenerationToken: 'regen-1',
    })

    expect(order).toEqual([
      'cancel:old-1',
      'remove:old-1',
      'cancel:old-2',
      'remove:old-2',
      'submit:0',
      'submit:1',
    ])
    expect(mocks.submitTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      dedupeKey: `${TASK_TYPE.IMAGE_CHARACTER}:appearance-1:single:0:regen:regen-1`,
    }))
  })
})
