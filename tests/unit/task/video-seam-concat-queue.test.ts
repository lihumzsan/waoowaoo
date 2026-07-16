import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const queueAddMock = vi.hoisted(() => vi.fn(async () => ({ id: 'job-1' })))

vi.mock('bullmq', () => ({
  Queue: class {
    add = queueAddMock
    setGlobalConcurrency = vi.fn(async () => undefined)
    getJob = vi.fn(async () => null)
  },
}))
vi.mock('@/lib/redis', () => ({ queueRedis: {} }))

describe('video seam concat queue policy', () => {
  beforeEach(() => queueAddMock.mockClear())

  it('routes seam concat to the video queue with one BullMQ attempt', async () => {
    const { addTaskJob, getQueueTypeByTaskType } = await import('@/lib/task/queues')
    const data: TaskJobData = {
      taskId: 'task-1',
      type: TASK_TYPE.VIDEO_SEAM_CONCAT,
      locale: 'zh',
      projectId: 'video-tools',
      targetType: 'VideoSeamConcat',
      targetId: 'target-1',
      payload: {},
      userId: 'user-1',
    }

    expect(getQueueTypeByTaskType(data.type)).toBe('video')
    await addTaskJob(data)

    expect(queueAddMock).toHaveBeenCalledWith(
      TASK_TYPE.VIDEO_SEAM_CONCAT,
      data,
      expect.objectContaining({ attempts: 1 }),
    )
  })
})
