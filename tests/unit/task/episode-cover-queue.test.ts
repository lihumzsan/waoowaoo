import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const queueAddMock = vi.hoisted(() => vi.fn(async () => ({ id: 'job-cover-1' })))

vi.mock('bullmq', () => ({
  Queue: class {
    add = queueAddMock
    setGlobalConcurrency = vi.fn(async () => undefined)
    getJob = vi.fn(async () => null)
  },
}))
vi.mock('@/lib/redis', () => ({ queueRedis: {} }))

function coverJobData(): TaskJobData {
  return {
    taskId: 'task-cover-1',
    type: TASK_TYPE.IMAGE_EPISODE_COVER,
    locale: 'zh',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'NovelPromotionEpisode',
    targetId: 'episode-1',
    payload: {},
    userId: 'user-1',
  }
}

describe('episode cover queue retry policy', () => {
  beforeEach(() => queueAddMock.mockClear())

  it('routes Episode covers to the image queue with exactly two BullMQ attempts', async () => {
    const { addTaskJob, getQueueTypeByTaskType } = await import('@/lib/task/queues')
    const data = coverJobData()

    expect(getQueueTypeByTaskType(data.type)).toBe('image')
    await addTaskJob(data)

    expect(queueAddMock).toHaveBeenCalledWith(
      TASK_TYPE.IMAGE_EPISODE_COVER,
      data,
      expect.objectContaining({ attempts: 2 }),
    )
  })

  it('does not let a caller restore the general five-attempt policy', async () => {
    const { addTaskJob } = await import('@/lib/task/queues')
    const data = coverJobData()

    await addTaskJob(data, { attempts: 5 })

    expect(queueAddMock).toHaveBeenCalledWith(
      TASK_TYPE.IMAGE_EPISODE_COVER,
      data,
      expect.objectContaining({ attempts: 2 }),
    )
  })
})
