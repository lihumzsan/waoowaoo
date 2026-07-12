import { describe, expect, it, vi } from 'vitest'
import {
  buildQueuedTaskRecoveryCutoff,
  recoverQueuedTaskCandidate,
} from '@/lib/task/watchdog-recovery'

describe('watchdog queued task recovery', () => {
  it('waits for the submitter grace window before considering a queued task recoverable', () => {
    const now = new Date('2026-07-10T15:19:25.000Z')

    expect(buildQueuedTaskRecoveryCutoff(now)).toEqual(
      new Date('2026-07-10T15:18:55.000Z'),
    )
  })

  it('re-reads the task and enqueues the latest run-bound payload with its original priority', async () => {
    const loadTask = vi.fn(async () => ({
      id: 'task-1',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'story_to_script_run',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      status: 'queued',
      enqueuedAt: null,
      priority: 2,
      payload: {
        runId: 'run-1',
        meta: { locale: 'zh', runId: 'run-1' },
      },
    }))
    const enqueue = vi.fn(async () => undefined)
    const markEnqueued = vi.fn(async () => undefined)

    const result = await recoverQueuedTaskCandidate({
      taskId: 'task-1',
      loadTask,
      enqueue,
      markEnqueued,
    })

    expect(loadTask).toHaveBeenCalledWith('task-1')
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        payload: expect.objectContaining({
          runId: 'run-1',
          meta: expect.objectContaining({ runId: 'run-1' }),
        }),
      }),
      { priority: 2 },
    )
    expect(markEnqueued).toHaveBeenCalledWith('task-1')
    expect(result).toMatchObject({ status: 'enqueued' })
  })

  it('skips a task that the normal submitter already enqueued', async () => {
    const loadTask = vi.fn(async () => ({
      id: 'task-1',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'story_to_script_run',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      status: 'queued',
      enqueuedAt: new Date('2026-07-10T15:18:55.624Z'),
      priority: 2,
      payload: {
        runId: 'run-1',
        meta: { locale: 'zh', runId: 'run-1' },
      },
    }))
    const enqueue = vi.fn(async () => undefined)
    const markEnqueued = vi.fn(async () => undefined)

    const result = await recoverQueuedTaskCandidate({
      taskId: 'task-1',
      loadTask,
      enqueue,
      markEnqueued,
    })

    expect(result).toEqual({ status: 'skipped' })
    expect(enqueue).not.toHaveBeenCalled()
    expect(markEnqueued).not.toHaveBeenCalled()
  })
})
