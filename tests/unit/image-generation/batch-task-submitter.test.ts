import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(async () => [] as Array<{ id: string; payload?: unknown }>),
  submitTask: vi.fn(),
  cancelTask: vi.fn<(taskId: string, reason?: string) => Promise<{ cancelled: boolean }>>(async () => ({ cancelled: true })),
  removeTaskJob: vi.fn<(taskId: string) => Promise<boolean>>(async () => true),
}))

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
    const batchId = result.batchId
    for (let index = 0; index < 3; index += 1) {
      expect(mocks.submitTask).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        targetId: 'location-1',
        payload: expect.objectContaining({
          count: 1,
          imageIndex: index,
          batch: { id: batchId, index, total: 3 },
        }),
        dedupeKey: `${TASK_TYPE.IMAGE_LOCATION}:location-1:batch:${batchId}:single:${index}`,
      }))
    }
    expect(result).toEqual({
      success: true,
      async: true,
      taskId: 'task-0',
      taskIds: ['task-0', 'task-1', 'task-2'],
      batchId,
      status: 'queued',
    })
  })

  it('uses the same batch identity for duplicate initial submissions', async () => {
    const input = {
      userId: 'user-1',
      locale: 'zh' as const,
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      targetType: 'LocationImage',
      targetId: 'location-1',
      payload: { count: 2 },
      count: 2,
    }

    const first = await submitImageBatchTasks(input)
    const second = await submitImageBatchTasks(input)

    expect(second.batchId).toBe(first.batchId)
    const batchIds = mocks.submitTask.mock.calls.map((call) => {
      const batch = call[0].payload?.batch as { id?: string } | undefined
      return batch?.id
    })
    expect(new Set(batchIds)).toEqual(new Set([first.batchId]))
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
      dedupeKey: expect.stringMatching(
        new RegExp(`^${TASK_TYPE.IMAGE_CHARACTER}:appearance-1:batch:.+:single:0:regen:regen-1$`),
      ),
    }))
  })

  it('supersedes an active batch when the requested count changes', async () => {
    mocks.findMany.mockResolvedValue([{
      id: 'old-1',
      payload: { batch: { id: 'old-batch', index: 0, total: 3 } },
    }])

    await submitImageBatchTasks({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      targetType: 'LocationImage',
      targetId: 'location-1',
      payload: { count: 2 },
      count: 2,
    })

    expect(mocks.cancelTask).toHaveBeenCalledWith('old-1', 'Superseded by a newer image batch')
    expect(mocks.removeTaskJob).toHaveBeenCalledWith('old-1')
  })

  it('supersedes an active legacy task without batch metadata', async () => {
    mocks.findMany.mockResolvedValue([{
      id: 'legacy-task',
      payload: { count: 3 },
    }])

    await submitImageBatchTasks({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      payload: { count: 3 },
      count: 3,
    })

    expect(mocks.cancelTask).toHaveBeenCalledWith(
      'legacy-task',
      'Superseded by a newer image batch',
    )
    expect(mocks.removeTaskJob).toHaveBeenCalledWith('legacy-task')
  })

  it('cancels children already submitted when a later child cannot be submitted', async () => {
    mocks.submitTask
      .mockResolvedValueOnce({
        success: true,
        async: true,
        taskId: 'task-0',
        status: 'queued',
        deduped: false,
      })
      .mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(submitImageBatchTasks({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      targetType: 'LocationImage',
      targetId: 'location-1',
      payload: { count: 3 },
      count: 3,
    })).rejects.toThrow('enqueue failed')

    expect(mocks.cancelTask).toHaveBeenCalledWith(
      'task-0',
      'Image batch submission failed before every child was queued',
    )
    expect(mocks.removeTaskJob).toHaveBeenCalledWith('task-0')
  })

  it('does not cancel deduped children or mask the original submission error', async () => {
    mocks.submitTask
      .mockResolvedValueOnce({
        success: true,
        async: true,
        taskId: 'existing-task-0',
        status: 'processing',
        deduped: true,
      })
      .mockRejectedValueOnce(new Error('enqueue failed'))
    mocks.cancelTask.mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(submitImageBatchTasks({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      targetType: 'LocationImage',
      targetId: 'location-1',
      payload: { count: 2 },
      count: 2,
    })).rejects.toThrow('enqueue failed')

    expect(mocks.cancelTask).not.toHaveBeenCalled()
    expect(mocks.removeTaskJob).not.toHaveBeenCalled()
  })
})
