import {
  beforeEach,
  describe,
  expect,
  it,
  listRecentTerminalLifecycleEvents,
  prismaQueryRawMock,
  redisPublishMock,
  scheduleResolvedProjectAgentWaitFollowUpsForTaskEventMock,
  taskEventCreateMock,
  taskEventFindManyMock,
  taskFindManyMock,
} from './publisher-replay.fixture'

describe('task publisher replay', () => {
  beforeEach(() => {
    taskEventFindManyMock.mockReset()
    taskEventCreateMock.mockReset()
    taskFindManyMock.mockReset()
    prismaQueryRawMock.mockReset()
    prismaQueryRawMock.mockResolvedValue([])
    redisPublishMock.mockReset()
    scheduleResolvedProjectAgentWaitFollowUpsForTaskEventMock.mockReset()
  })

  it('replays recent terminal lifecycle events scoped by episode', async () => {
    taskEventFindManyMock.mockResolvedValueOnce([
      {
        id: 201,
        taskId: 'task-1',
        projectId: 'project-1',
        userId: 'user-1',
        eventType: 'task.completed',
        payload: { lifecycleType: 'task.completed' },
        createdAt: new Date('2026-02-27T00:00:05.000Z'),
      },
    ])
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task-1',
        type: 'image_panel',
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        episodeId: 'episode-1',
        payload: null,
      },
    ])

    const events = await listRecentTerminalLifecycleEvents({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      limit: 20,
    })

    expect(taskEventFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-1',
        userId: 'user-1',
        eventType: { in: ['task.completed', 'task.failed'] },
        task: { episodeId: 'episode-1' },
      },
      orderBy: { id: 'desc' },
      take: 20,
    }))
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(expect.objectContaining({
      id: '201',
      type: 'task.lifecycle',
      taskId: 'task-1',
      taskType: 'image_panel',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      episodeId: 'episode-1',
    }))
  })

  it('replays terminal image events with the direct panel target from task payload', async () => {
    taskEventFindManyMock.mockResolvedValueOnce([
      {
        id: 301,
        taskId: 'task-panel-1',
        projectId: 'project-1',
        userId: 'user-1',
        eventType: 'task.completed',
        payload: { lifecycleType: 'task.completed' },
        createdAt: new Date('2026-02-27T00:00:06.000Z'),
      },
    ])
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task-panel-1',
        type: 'image_panel',
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        episodeId: 'episode-1',
        payload: {
          panelId: 'panel-1',
        },
      },
    ])

    const events = await listRecentTerminalLifecycleEvents({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      limit: 20,
    })

    expect(events[0]?.payload?.coveredTargets).toEqual([
      { targetType: 'ProjectPanel', targetId: 'panel-1' },
    ])
  })
})
