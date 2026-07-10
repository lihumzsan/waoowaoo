import {
  FakeEventSource,
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  apiFetchMock,
  beforeEach,
  describe,
  expect,
  hasInvalidation,
  it,
  overlayMock,
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

  it('PROCESSING(progress 数值) 不触发 target-state invalidation；COMPLETED 触发', async () => {
    const { useSSE } = await import('@/lib/query/hooks/useSSE')

    useSSE({
      projectId: 'project-1',
      episodeId: 'episode-1',
      enabled: true,
    })

    const source = FakeEventSource.instances[0]
    expect(source).toBeTruthy()

    source.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, {
      id: '1',
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:00.000Z',
      taskType: 'image_character',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.PROCESSING,
        progress: 32,
      },
    })

    expect(hasInvalidation((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key) && key[0] === 'task-target-states'
    })).toBe(false)

    source.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, {
      id: '2',
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:01.000Z',
      taskType: 'image_character',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
        affectedResources: [
          { kind: 'projectAssets', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'editScript', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'episodeData', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'projectContext', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'projectData', projectId: 'project-1' },
        ],
      },
    })

    for (const cb of runtime.scheduledTimers) cb()

    expect(hasInvalidation((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.tasks.targetStatesAll('project-1')[0]
        && key[1] === 'project-1'
        && arg.exact === false
    })).toBe(true)

    expect(runtime.queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.project.editScript('project-1', 'episode-1'),
      type: 'active',
    })

    expect(overlayMock.applyTaskLifecycleToOverlay).toHaveBeenCalledWith(
      runtime.queryClient,
      expect.objectContaining({
        projectId: 'project-1',
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
      }),
    )
  })

  it('terminal task events without affectedResources do not infer resource refreshes from task type', async () => {
    const { useSSE } = await import('@/lib/query/hooks/useSSE')

    useSSE({
      projectId: 'project-1',
      episodeId: 'episode-1',
      enabled: true,
    })

    const source = FakeEventSource.instances[0]
    expect(source).toBeTruthy()

    source.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, {
      id: 'no-affected-resources',
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: 'task-no-resources',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:01.000Z',
      taskType: 'image_character',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      },
    })

    expect(runtime.queryClient.refetchQueries).not.toHaveBeenCalledWith({
      queryKey: queryKeys.project.editScript('project-1', 'episode-1'),
      type: 'active',
    })
  })

  it('writes the materialized Query DTO before notifying runtime listeners to clear the stream', async () => {
    const { useSSE } = await import('@/lib/query/hooks/useSSE')
    const episode = {
      id: 'episode-1',
      name: 'Materialized episode',
      updatedAt: '2026-04-24T00:00:01.000Z',
      resourceVersion: {
        scheme: 'aggregate_updated_at',
        value: '2026-04-24T00:00:01.000Z',
      },
    }
    const runtimeClear = vi.fn(() => {
      expect(runtime.queryClient.setQueryData).toHaveBeenCalledWith(
        queryKeys.episodeData('project-1', 'episode-1'),
        episode,
      )
    })

    useSSE({
      projectId: 'project-1',
      episodeId: 'episode-1',
      enabled: true,
      onEvent: runtimeClear,
    })

    FakeEventSource.instances[0]?.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, {
      id: 'materialized-terminal-1',
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: 'task-materialized-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:01.000Z',
      taskType: 'video_panel',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
        materializedResources: [{
          kind: 'episodeData',
          projectId: 'project-1',
          episodeId: 'episode-1',
          resourceKey: 'episodeData:project-1:episode-1',
          resourceVersion: {
            scheme: 'aggregate_updated_at',
            value: '2026-04-24T00:00:01.000Z',
          },
          taskId: 'task-materialized-1',
          data: episode,
        }],
      },
    })

    expect(runtimeClear).toHaveBeenCalledTimes(1)
  })
})
