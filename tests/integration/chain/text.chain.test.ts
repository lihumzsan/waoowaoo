import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type AddCall = {
  jobName: string
  data: TaskJobData
  options: Record<string, unknown>
}

const queueState = vi.hoisted(() => ({
  addCallsByQueue: new Map<string, AddCall[]>(),
}))

vi.mock('bullmq', () => ({
  Queue: class {
    private readonly queueName: string

    constructor(queueName: string) {
      this.queueName = queueName
    }

    async add(jobName: string, data: TaskJobData, options: Record<string, unknown>) {
      const list = queueState.addCallsByQueue.get(this.queueName) || []
      list.push({ jobName, data, options })
      queueState.addCallsByQueue.set(this.queueName, list)
      return { id: data.taskId }
    }

    async getJob() {
      return null
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))

describe('chain contract - text queue behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueState.addCallsByQueue.clear()
  })

  it('text tasks are enqueued into text queue', async () => {
    const { addTaskJob, QUEUE_NAME } = await import('@/lib/task/queues')

    await addTaskJob({
      taskId: 'task-text-1',
      type: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      payload: { episodeId: 'episode-1' },
      userId: 'user-1',
    })

    const calls = queueState.addCallsByQueue.get(QUEUE_NAME.TEXT) || []
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.objectContaining({
      jobName: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      options: expect.objectContaining({ jobId: 'task-text-1', priority: 0 }),
    }))
  })

  it('enqueues text tasks without BullMQ retry options', async () => {
    const { addTaskJob, QUEUE_NAME } = await import('@/lib/task/queues')

    await addTaskJob({
      taskId: 'task-text-story-1',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      payload: { episodeId: 'episode-1' },
      userId: 'user-1',
    })

    const calls = queueState.addCallsByQueue.get(QUEUE_NAME.TEXT) || []
    expect(calls).toHaveLength(1)
    expect(calls[0]?.options).toEqual(expect.objectContaining({ jobId: 'task-text-story-1' }))
    expect(calls[0]?.options).not.toHaveProperty('attempts')
    expect(calls[0]?.options).not.toHaveProperty('backoff')
  })

  it('explicit priority is preserved for text queue jobs', async () => {
    const { addTaskJob, QUEUE_NAME } = await import('@/lib/task/queues')

    await addTaskJob({
      taskId: 'task-text-2',
      type: TASK_TYPE.REFERENCE_TO_CHARACTER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'Project',
      targetId: 'project-1',
      payload: { referenceImageUrl: 'https://example.com/ref.png' },
      userId: 'user-1',
    }, { priority: 7 })

    const calls = queueState.addCallsByQueue.get(QUEUE_NAME.TEXT) || []
    expect(calls).toHaveLength(1)
    expect(calls[0]?.options).toEqual(expect.objectContaining({ priority: 7, jobId: 'task-text-2' }))
  })
})
