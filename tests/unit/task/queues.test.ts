import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_RETRY_BACKOFF_BASE_MS } from '@/lib/task/retry-policy'
import type { TaskJobData } from '@/lib/task/types'

const queueInstances: Array<{
  add: ReturnType<typeof vi.fn>
  getJob: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}> = []

const QueueMock = vi.hoisted(() => vi.fn().mockImplementation(() => {
  const instance = {
    add: vi.fn(),
    getJob: vi.fn(),
    close: vi.fn(),
  }
  queueInstances.push(instance)
  return instance
}))

vi.mock('bullmq', () => ({
  Queue: QueueMock,
}))

vi.mock('@/lib/redis', () => ({
  queueRedis: {},
}))

describe('task queues', () => {
  beforeEach(() => {
    vi.resetModules()
    QueueMock.mockClear()
    queueInstances.length = 0
    delete (globalThis as typeof globalThis & { __waoowaooQueues?: unknown }).__waoowaooQueues
  })

  it('importing the module does not instantiate queues eagerly', async () => {
    await import('@/lib/task/queues')

    expect(QueueMock).not.toHaveBeenCalled()
  })

  it('requesting a queue lazily instantiates only the needed queue', async () => {
    const queuesModule = await import('@/lib/task/queues')

    const queue = queuesModule.getQueueByType('image')

    expect(queue).toBeDefined()
    expect(QueueMock).toHaveBeenCalledTimes(1)
    const options = QueueMock.mock.calls[0]?.[1] as { defaultJobOptions?: Record<string, unknown> } | undefined
    expect(options?.defaultJobOptions).toEqual({
      removeOnComplete: 500,
      removeOnFail: 500,
    })
    expect(options?.defaultJobOptions).not.toHaveProperty('attempts')
    expect(options?.defaultJobOptions).not.toHaveProperty('backoff')
  })

  it('routes music generation tasks to the music queue', async () => {
    const queuesModule = await import('@/lib/task/queues')
    const taskTypes = await import('@/lib/task/types')

    expect(queuesModule.getQueueTypeByTaskType(taskTypes.TASK_TYPE.MUSIC_GENERATE)).toBe('music')
    expect(queuesModule.getQueueTypeByTaskType(taskTypes.TASK_TYPE.MUSIC_SCORE_PLAN)).toBe('music')

    const queue = queuesModule.getQueueByType('music')
    expect(queue).toBeDefined()
    expect(QueueMock).toHaveBeenCalledTimes(1)
  })

  it('routes final video render tasks to the video queue', async () => {
    const queuesModule = await import('@/lib/task/queues')
    const taskTypes = await import('@/lib/task/types')

    expect(queuesModule.getQueueTypeByTaskType(taskTypes.TASK_TYPE.FINAL_VIDEO_RENDER)).toBe('video')

    const queue = queuesModule.getQueueByType('video')
    expect(queue).toBeDefined()
    expect(QueueMock).toHaveBeenCalledTimes(1)
  })

  it('routes style preview parent generation to the text queue', async () => {
    const queuesModule = await import('@/lib/task/queues')
    const taskTypes = await import('@/lib/task/types')

    expect(queuesModule.getQueueTypeByTaskType(taskTypes.TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE)).toBe('text')
    expect(queuesModule.getQueueTypeByTaskType(taskTypes.TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE)).toBe('image')
  })

  it('removes a terminal job with the same task id before enqueueing replacement work', async () => {
    const queuesModule = await import('@/lib/task/queues')
    const taskTypes = await import('@/lib/task/types')
    const queue = queuesModule.getQueueByType('image')
    const queueMock = queue as unknown as typeof queueInstances[number]
    const remove = vi.fn(async () => undefined)
    const getState = vi.fn(async () => 'failed')
    queueMock.getJob.mockResolvedValue({ getState, remove })

    const jobData = {
      taskId: 'task-1',
      type: taskTypes.TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEditStylePreview',
      targetId: 'style-preview-1',
      payload: { meta: { locale: 'zh' } },
      billingInfo: null,
      userId: 'user-1',
      trace: null,
    } satisfies TaskJobData

    await queuesModule.addTaskJob(jobData)

    expect(queueMock.getJob).toHaveBeenCalledWith('task-1')
    expect(getState).toHaveBeenCalled()
    expect(remove).toHaveBeenCalled()
    expect(queueMock.add).toHaveBeenCalledWith(
      taskTypes.TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      jobData,
      expect.objectContaining({
        jobId: 'task-1',
        priority: 0,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: TASK_RETRY_BACKOFF_BASE_MS,
        },
      }),
    )
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(queueMock.add.mock.invocationCallOrder[0])
  })

  it('uses default task-level retry for idempotent queued work', async () => {
    const queuesModule = await import('@/lib/task/queues')
    const taskTypes = await import('@/lib/task/types')
    const queue = queuesModule.getQueueByType('text')
    const queueMock = queue as unknown as typeof queueInstances[number]

    const jobData = {
      taskId: 'task-text-1',
      type: taskTypes.TASK_TYPE.EDIT_SCRIPT_GENERATE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      payload: { meta: { locale: 'zh' } },
      billingInfo: null,
      userId: 'user-1',
      trace: null,
    } satisfies TaskJobData

    await queuesModule.addTaskJob(jobData)

    expect(queueMock.add).toHaveBeenCalledWith(
      taskTypes.TASK_TYPE.EDIT_SCRIPT_GENERATE,
      jobData,
      expect.objectContaining({
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: TASK_RETRY_BACKOFF_BASE_MS,
        },
      }),
    )
  })

  it('does not enable task-level retry for final video render', async () => {
    const queuesModule = await import('@/lib/task/queues')
    const taskTypes = await import('@/lib/task/types')
    const queue = queuesModule.getQueueByType('video')
    const queueMock = queue as unknown as typeof queueInstances[number]

    const jobData = {
      taskId: 'task-video-final-1',
      type: taskTypes.TASK_TYPE.FINAL_VIDEO_RENDER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      payload: { meta: { locale: 'zh' } },
      billingInfo: null,
      userId: 'user-1',
      trace: null,
    } satisfies TaskJobData

    await queuesModule.addTaskJob(jobData)

    expect(queueMock.add).toHaveBeenCalledWith(
      taskTypes.TASK_TYPE.FINAL_VIDEO_RENDER,
      jobData,
      expect.objectContaining({
        attempts: 1,
      }),
    )
  })

  it('does not enable task-level retry for chapter render', async () => {
    const queuesModule = await import('@/lib/task/queues')
    const taskTypes = await import('@/lib/task/types')
    const queue = queuesModule.getQueueByType('video')
    const queueMock = queue as unknown as typeof queueInstances[number]

    const jobData = {
      taskId: 'task-chapter-render-1',
      type: taskTypes.TASK_TYPE.CHAPTER_RENDER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
      payload: { meta: { locale: 'zh' } },
      billingInfo: null,
      userId: 'user-1',
      trace: null,
    } satisfies TaskJobData

    await queuesModule.addTaskJob(jobData)

    expect(queueMock.add).toHaveBeenCalledWith(
      taskTypes.TASK_TYPE.CHAPTER_RENDER,
      jobData,
      expect.objectContaining({
        attempts: 1,
      }),
    )
  })
})
