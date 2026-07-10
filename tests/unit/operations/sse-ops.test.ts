import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
type ReplayEvent = {
  id: string
  type: string
  mutationBatchId?: string
  taskId?: string
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  projectId: string
  userId: string
  ts: string
  operationId?: string | null
  episodeId: string | null
  targets?: Array<{ targetType: string; targetId: string }>
  payload?: Record<string, unknown> | null
}
type TaskSnapshotRow = {
  id: string
  type: string
  targetType: string
  targetId: string
  episodeId: string | null
  userId: string
  status: string
  progress: number
  payload: Record<string, unknown> | null
  updatedAt: Date
}
const listEventsAfterMock = vi.hoisted(() => vi.fn<() => Promise<ReplayEvent[]>>(async () => []))
const listRecentTerminalLifecycleEventsMock = vi.hoisted(() => vi.fn<() => Promise<ReplayEvent[]>>(async () => []))
const listMutationBatchReplayEventsMock = vi.hoisted(() => vi.fn<() => Promise<ReplayEvent[]>>(async () => []))
const taskFindManyMock = vi.hoisted(() => vi.fn<() => Promise<TaskSnapshotRow[]>>(async () => []))
vi.mock('@/lib/task/publisher', () => ({
  getProjectChannel: (projectId: string) => `project:${projectId}`,
  listEventsAfter: listEventsAfterMock,
  listRecentTerminalLifecycleEvents: listRecentTerminalLifecycleEventsMock,
}))
vi.mock('@/lib/mutation-batch/service', () => ({
  listMutationBatchReplayEvents: listMutationBatchReplayEventsMock,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: taskFindManyMock,
    },
  },
}))
import { createSseOperations } from '@/lib/operations/domains/debug/sse-ops'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
function buildCtx(): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as ProjectAgentOperationContext['request'],
    userId: 'user-1',
    projectId: 'project-1',
    context: {},
    source: 'project-ui',
    writer: null,
  }
}
describe('sse bootstrap operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskFindManyMock.mockResolvedValue([])
    listRecentTerminalLifecycleEventsMock.mockResolvedValue([])
  })
  afterEach(() => vi.useRealTimers())
  it('replays only missed numeric events after the cursor', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:05:00.000Z'))
    const missedEvent = {
      id: '15',
      type: 'task.lifecycle',
      taskId: 'task-video-1',
      taskType: 'video_panel',
      targetType: 'ProjectPanel',
      targetId: 'panel-2',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:04:00.000Z',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: 'task.processing',
        progress: 20,
      },
    }
    listEventsAfterMock.mockResolvedValueOnce([missedEvent])
    const ops = createSseOperations()
    const result = await ops.get_sse_bootstrap.execute!(
      buildCtx() as never,
      {
        episodeId: 'episode-1',
        lastEventId: '14',
        snapshotLimit: 100,
      } as never,
    )
    expect(listEventsAfterMock).toHaveBeenCalledWith('project-1', 14, 5000)
    expect(listRecentTerminalLifecycleEventsMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      channel: 'project:project-1',
      mode: 'missed_event_replay',
      fromEventId: '14',
      events: [
        missedEvent,
        expect.objectContaining({
          id: 'mb:1776989100000:recovery:project-1:1776989100000',
          type: 'mutation.batch',
          mutationBatchId: 'recovery:project-1:1776989100000',
          targets: [{ targetType: 'ProjectEpisode', targetId: 'episode-1' }],
        }),
      ],
    })
    vi.useRealTimers()
  })
  it('returns no recoverable terminal snapshot for replay polling without a cursor', async () => {
    const ops = createSseOperations()
    const result = await ops.get_sse_bootstrap.execute!(
      buildCtx() as never,
      {
        episodeId: 'episode-1',
        includeRecoverableSnapshot: false,
      } as never,
    )
    expect(listRecentTerminalLifecycleEventsMock).not.toHaveBeenCalled()
    expect(taskFindManyMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      channel: 'project:project-1',
      mode: 'missed_event_replay_without_cursor',
      events: [],
    })
  })
  it('replays mutation batches and active task snapshot from a mutation Last-Event-ID cursor', async () => {
    const event = {
      id: 'mb:1777046400000:batch-2',
      type: 'mutation.batch',
      mutationBatchId: 'batch-2',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:00.000Z',
      operationId: 'update_storyboard_panel_prompt',
      episodeId: 'episode-1',
      targets: [{ targetType: 'ProjectStoryboard', targetId: 'storyboard-1' }],
    }
    listMutationBatchReplayEventsMock.mockResolvedValueOnce([event])
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task-1',
        type: 'image_panel',
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        episodeId: 'episode-1',
        userId: 'user-1',
        status: 'processing',
        progress: 50,
        payload: { ui: { intent: 'generate' } },
        updatedAt: new Date('2026-04-24T00:01:00.000Z'),
      },
    ])
    const ops = createSseOperations()
    const result = await ops.get_sse_bootstrap.execute!(
      buildCtx() as never,
      {
        episodeId: 'episode-1',
        lastEventId: 'mb:1777046300000:batch-1',
      } as never,
    )
    expect(listMutationBatchReplayEventsMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      after: {
        createdAt: new Date(1777046300000),
        batchId: 'batch-1',
      },
      episodeId: 'episode-1',
      limit: 5000,
    })
    expect(listEventsAfterMock).not.toHaveBeenCalled()
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'project-1',
          userId: 'user-1',
          episodeId: 'episode-1',
        }),
      }),
    )
    expect(result).toEqual({
      channel: 'project:project-1',
      mode: 'mutation_replay_with_active_snapshot',
      fromEventId: 'mb:1777046300000:batch-1',
      events: [
        event,
        expect.objectContaining({
          id: 'snapshot:task-1:1776988860000',
          type: 'task.lifecycle',
          taskId: 'task-1',
          targetType: 'ProjectPanel',
          targetId: 'panel-1',
          episodeId: 'episode-1',
          payload: expect.objectContaining({
            lifecycleType: 'task.processing',
            progress: 50,
          }),
        }),
      ],
    })
  })
  it('replays task and mutation domains from one durable composite cursor', async () => {
    const taskEvent = {
      id: '16',
      type: 'task.lifecycle',
      taskId: 'task-16',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:02.000Z',
      episodeId: 'episode-1',
      payload: { lifecycleType: 'task.completed' },
    }
    const mutationEvent = {
      id: 'mb:1777046400001:batch-3',
      type: 'mutation.batch',
      mutationBatchId: 'batch-3',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:03.000Z',
      operationId: 'update_storyboard_panel_prompt',
      episodeId: 'episode-1',
      targets: [{ targetType: 'ProjectPanel', targetId: 'panel-1' }],
    }
    listEventsAfterMock.mockResolvedValueOnce([taskEvent])
    listMutationBatchReplayEventsMock.mockResolvedValueOnce([mutationEvent])
    const result = await createSseOperations().get_sse_bootstrap.execute!(
      buildCtx() as never,
      {
        episodeId: 'episode-1',
        lastEventId: 'v1;t=15;m=1777046400000:batch-2',
      } as never,
    )
    expect(listEventsAfterMock).toHaveBeenCalledWith('project-1', 15, 5000)
    expect(listMutationBatchReplayEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        after: {
          createdAt: new Date(1777046400000),
          batchId: 'batch-2',
        },
      }),
    )
    expect(taskFindManyMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      channel: 'project:project-1',
      mode: 'composite_replay',
      fromEventId: 'v1;t=15;m=1777046400000:batch-2',
      events: [taskEvent, mutationEvent],
    })
  })
  it('returns recent terminal events with the active snapshot when no replay cursor exists', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:05:00.000Z'))
    const terminalEvent = {
      id: '12',
      type: 'task.lifecycle',
      taskId: 'task-image-1',
      taskType: 'image_panel',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:02:00.000Z',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: 'task.completed',
      },
    }
    listRecentTerminalLifecycleEventsMock.mockResolvedValueOnce([terminalEvent])
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task-2',
        type: 'video_panel',
        targetType: 'ProjectPanel',
        targetId: 'panel-2',
        episodeId: 'episode-1',
        userId: 'user-1',
        status: 'processing',
        progress: 40,
        payload: null,
        updatedAt: new Date('2026-04-24T00:03:00.000Z'),
      },
    ])
    const ops = createSseOperations()
    const result = await ops.get_sse_bootstrap.execute!(
      buildCtx() as never,
      {
        episodeId: 'episode-1',
      } as never,
    )
    expect(listRecentTerminalLifecycleEventsMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      limit: 200,
    })
    expect(result).toEqual({
      channel: 'project:project-1',
      mode: 'recoverable_snapshot',
      events: [
        terminalEvent,
        expect.objectContaining({
          id: 'snapshot:task-2:1776988980000',
          type: 'task.lifecycle',
          taskId: 'task-2',
          targetType: 'ProjectPanel',
          targetId: 'panel-2',
          episodeId: 'episode-1',
          payload: expect.objectContaining({
            lifecycleType: 'task.processing',
            progress: 40,
          }),
        }),
        expect.objectContaining({
          id: 'mb:1776989100000:recovery:project-1:1776989100000',
          type: 'mutation.batch',
          mutationBatchId: 'recovery:project-1:1776989100000',
          targets: [{ targetType: 'ProjectEpisode', targetId: 'episode-1' }],
        }),
      ],
    })
    vi.useRealTimers()
  })
})
