import {
  FakeEventSource,
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  WORKSPACE_SSE_EVENT_TYPE,
  apiFetchMock,
  beforeEach,
  describe,
  expect,
  hasInvalidation,
  it,
  queryKeys,
  runtime,
  vi,
} from './sse-invalidation.fixture'

describe('sse invalidation behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.effectCleanup = null
    runtime.scheduledTimers = []
    runtime.scheduledIntervals = []
    FakeEventSource.instances = []
    apiFetchMock.apiFetch.mockReset()

    ;(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource
    ;(globalThis as unknown as { window: {
      setTimeout: typeof setTimeout
      clearTimeout: typeof clearTimeout
      setInterval: typeof setInterval
      clearInterval: typeof clearInterval
    } }).window = {
      setTimeout: ((cb: () => void) => {
        runtime.scheduledTimers.push(cb)
        return runtime.scheduledTimers.length as unknown as ReturnType<typeof setTimeout>
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
      setInterval: ((cb: () => void) => {
        runtime.scheduledIntervals.push(cb)
        return runtime.scheduledIntervals.length as unknown as ReturnType<typeof setInterval>
      }) as unknown as typeof setInterval,
      clearInterval: (() => undefined) as unknown as typeof clearInterval,
    }
  })

  it('applies replayed image panel completion events even when the stored cursor already advanced', async () => {
    const { useSSE } = await import('@/lib/query/hooks/useSSE')

    apiFetchMock.apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        events: [{
          id: '11',
          type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
          taskId: 'task-image-1',
          taskType: 'image_panel',
          targetType: 'ProjectPanel',
          targetId: 'panel-1',
          projectId: 'project-1',
          userId: 'user-1',
          ts: '2026-04-24T00:00:01.000Z',
          episodeId: 'episode-1',
          payload: {
            lifecycleType: TASK_EVENT_TYPE.COMPLETED,
            imageUrl: 'https://example.test/panel.jpg',
            affectedResources: [
              { kind: 'storyboards', projectId: 'project-1', episodeId: 'episode-1' },
              { kind: 'editScript', projectId: 'project-1', episodeId: 'episode-1' },
              { kind: 'episodeData', projectId: 'project-1', episodeId: 'episode-1' },
              { kind: 'projectContext', projectId: 'project-1', episodeId: 'episode-1' },
              { kind: 'projectData', projectId: 'project-1' },
            ],
          },
        }],
      }),
    })

    useSSE({
      projectId: 'project-1',
      episodeId: 'episode-1',
      enabled: true,
    })

    const source = FakeEventSource.instances[0]
    expect(source).toBeTruthy()

    source.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, {
      id: '12',
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: 'task-video-1',
      taskType: 'video_panel',
      targetType: 'ProjectPanel',
      targetId: 'panel-2',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:02.000Z',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.PROCESSING,
        progress: 99,
      },
    })

    const replayResponse = await apiFetchMock.apiFetch()
    const replayPayload = await replayResponse.json()
    source.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, replayPayload.events[0])
    expect(hasInvalidation((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.episodeData('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.storyboards.all('episode-1')[0]
        && key[1] === 'episode-1'
    })).toBe(true)
    expect(runtime.queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.storyboards.all('episode-1'),
      type: 'active',
    })
  })

  it('resource.changed 事件按资源名称触发 query invalidation', async () => {
    const { useSSE } = await import('@/lib/query/hooks/useSSE')

    useSSE({
      projectId: 'project-1',
      episodeId: 'episode-1',
      enabled: true,
    })

    const source = FakeEventSource.instances[0]
    expect(source).toBeTruthy()

    source.emit(WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED, {
      id: 'resource:1',
      type: WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
      projectId: 'project-1',
      userId: 'user-2',
      ts: '2026-04-24T00:00:00.000Z',
      affectedResources: [
        { kind: 'editBible', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'editScript', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'episodeData', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'projectContext', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'projectData', projectId: 'project-1' },
      ],
    })

    expect(hasInvalidation((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editBible('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-bible'
        && key[3] === 'episode-1'
    })).toBe(true)

    expect(hasInvalidation((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editScript('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-script'
        && key[3] === 'episode-1'
    })).toBe(true)

    expect(hasInvalidation((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.projectData('project-1')[0]
        && key[1] === 'project-1'
    })).toBe(true)
  })
})
