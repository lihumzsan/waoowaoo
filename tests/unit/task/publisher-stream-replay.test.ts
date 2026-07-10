import {
  beforeEach,
  describe,
  expect,
  it,
  listTaskLifecycleEvents,
  prismaQueryRawMock,
  publishTaskStreamEvent,
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

  it('replays persisted lifecycle + stream rows in chronological order', async () => {
    taskEventFindManyMock.mockResolvedValueOnce([
      {
        id: 12,
        taskId: 'task-1',
        projectId: 'project-1',
        userId: 'user-1',
        eventType: 'task.stream',
        payload: {
          stepId: 'step-1',
          stream: {
            kind: 'text',
            seq: 2,
            lane: 'main',
            delta: 'world',
          },
        },
        createdAt: new Date('2026-02-27T00:00:02.000Z'),
      },
      {
        id: 11,
        taskId: 'task-1',
        projectId: 'project-1',
        userId: 'user-1',
        eventType: 'task.processing',
        payload: {
          lifecycleType: 'task.processing',
          stepId: 'step-1',
          stepTitle: '阶段1',
        },
        createdAt: new Date('2026-02-27T00:00:01.000Z'),
      },
      {
        id: 10,
        taskId: 'task-1',
        projectId: 'project-1',
        userId: 'user-1',
        eventType: 'task.ignored',
        payload: {},
        createdAt: new Date('2026-02-27T00:00:00.000Z'),
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

    const events = await listTaskLifecycleEvents('task-1', 50)

    expect(taskEventFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId: 'task-1' },
      orderBy: { id: 'desc' },
      take: 50,
    }))
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.id)).toEqual(['11', '12'])
    expect(events.map((event) => event.type)).toEqual(['task.lifecycle', 'task.stream'])
    expect((events[1]?.payload as { stream?: { delta?: string } }).stream?.delta).toBe('world')
  })

  it('persists stream rows when persist=true', async () => {
    taskEventCreateMock.mockResolvedValueOnce({
      id: 99,
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      eventType: 'task.stream',
      payload: {
        stream: {
          kind: 'text',
          seq: 1,
          lane: 'main',
          delta: 'hello',
        },
      },
      createdAt: new Date('2026-02-27T00:00:03.000Z'),
    })
    redisPublishMock.mockResolvedValueOnce(1)

    const message = await publishTaskStreamEvent({
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      taskType: 'bible_convert',
      targetType: 'episode',
      targetId: 'episode-1',
      episodeId: 'episode-1',
      payload: {
        stepId: 'step-1',
        stream: {
          kind: 'text',
          seq: 1,
          lane: 'main',
          delta: 'hello',
        },
      },
      persist: true,
    })

    expect(taskEventCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskId: 'task-1',
        eventType: 'task.stream',
      }),
    }))
    expect(redisPublishMock).toHaveBeenCalledTimes(1)
    expect(message?.id).toBe('99')
    expect(message?.type).toBe('task.stream')
  })
})
