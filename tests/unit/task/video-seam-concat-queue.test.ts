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

  it.each([
    TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE,
    TASK_TYPE.ENVIRONMENT_SOUND_GENERATE,
  ])('routes %s to the video queue with one BullMQ attempt', async (type) => {
    const { addTaskJob, getQueueTypeByTaskType } = await import('@/lib/task/queues')
    const data: TaskJobData = {
      taskId: 'task-environment',
      type,
      locale: 'zh',
      projectId: 'video-tools',
      targetType: 'EnvironmentSound',
      targetId: 'target-environment',
      payload: {},
      userId: 'user-1',
    }

    expect(getQueueTypeByTaskType(type)).toBe('video')
    await addTaskJob(data)

    expect(queueAddMock).toHaveBeenCalledWith(
      type,
      data,
      expect.objectContaining({ attempts: 1 }),
    )
  })

  it('routes environment-sound cleanup to video without forcing a single attempt', async () => {
    const cleanupType = (TASK_TYPE as Record<string, string>).ENVIRONMENT_SOUND_CLEANUP
    expect(cleanupType).toBe('environment_sound_cleanup')
    const { addTaskJob, getQueueTypeByTaskType } = await import('@/lib/task/queues')
    const data = {
      taskId: 'task-environment-cleanup',
      type: cleanupType,
      locale: 'zh',
      projectId: 'video-tools',
      targetType: 'EnvironmentSoundCleanup',
      targetId: 'target-environment-cleanup',
      payload: { objectKey: 'video-tools/user-1/environment-sounds/output.mp3' },
      userId: 'user-1',
    } as TaskJobData

    expect(getQueueTypeByTaskType(data.type)).toBe('video')
    await addTaskJob(data, { attempts: 3 })

    expect(queueAddMock).toHaveBeenCalledWith(
      cleanupType,
      data,
      expect.objectContaining({ attempts: 3 }),
    )
  })
})
