import {
  TASK_EVENT_TYPE,
  TASK_TYPE,
  beforeEach,
  describe,
  expect,
  it,
  listEventsAfter,
  prismaQueryRawMock,
  publishTaskEvent,
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

  it('publishes terminal lifecycle events with explicit affected resources', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task-1',
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        episodeId: 'episode-1',
        payload: null,
      },
    ])
    taskEventCreateMock.mockResolvedValueOnce({
      id: 100,
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      eventType: TASK_EVENT_TYPE.COMPLETED,
      payload: null,
      createdAt: new Date('2026-02-27T00:00:03.000Z'),
    })
    redisPublishMock.mockResolvedValueOnce(1)

    const message = await publishTaskEvent({
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      type: TASK_EVENT_TYPE.COMPLETED,
      taskType: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      episodeId: 'episode-1',
      payload: {
        imageUrl: 'https://example.test/panel.png',
      },
    })

    const expectedAffectedResources = [
      { kind: 'storyboards', projectId: 'project-1', episodeId: 'episode-1' },
      { kind: 'editScript', projectId: 'project-1', episodeId: 'episode-1' },
      { kind: 'episodeData', projectId: 'project-1', episodeId: 'episode-1' },
      { kind: 'projectContext', projectId: 'project-1', episodeId: 'episode-1' },
      { kind: 'projectData', projectId: 'project-1' },
    ]

    expect(taskEventCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskId: 'task-1',
        eventType: TASK_EVENT_TYPE.COMPLETED,
        payload: expect.objectContaining({
          lifecycleType: TASK_EVENT_TYPE.COMPLETED,
          affectedResources: expectedAffectedResources,
        }),
      }),
    }))
    expect(message?.payload?.affectedResources).toEqual(expectedAffectedResources)
    expect(redisPublishMock).toHaveBeenCalledTimes(1)
    expect(scheduleResolvedProjectAgentWaitFollowUpsForTaskEventMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
    expect(redisPublishMock.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleResolvedProjectAgentWaitFollowUpsForTaskEventMock.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('replays lifecycle + stream rows in listEventsAfter', async () => {
    taskEventFindManyMock.mockResolvedValueOnce([
      {
        id: 101,
        taskId: 'task-1',
        projectId: 'project-1',
        userId: 'user-1',
        eventType: 'task.stream',
        payload: {
          stepId: 'step-1',
          stream: {
            kind: 'text',
            seq: 3,
            lane: 'main',
            delta: 'chunk',
          },
        },
        createdAt: new Date('2026-02-27T00:00:03.000Z'),
      },
      {
        id: 102,
        taskId: 'task-1',
        projectId: 'project-1',
        userId: 'user-1',
        eventType: 'task.processing',
        payload: {
          lifecycleType: 'task.processing',
          stepId: 'step-1',
        },
        createdAt: new Date('2026-02-27T00:00:04.000Z'),
      },
    ])
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task-1',
        type: 'bible_convert',
        targetType: 'episode',
        targetId: 'episode-1',
        episodeId: 'episode-1',
      },
    ])

    const events = await listEventsAfter('project-1', 100, 20)

    expect(taskEventFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-1',
        id: { gt: 100 },
      },
      orderBy: { id: 'asc' },
    }))
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.id)).toEqual(['101', '102'])
    expect(events.map((event) => event.type)).toEqual(['task.stream', 'task.lifecycle'])
    expect((events[0]?.payload as { stream?: { delta?: string } }).stream?.delta).toBe('chunk')
  })
})
