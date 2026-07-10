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
  type InvalidateArg,
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

  it('does not apply duplicate SSE event ids twice', async () => {
    const { useSSE } = await import('@/lib/query/hooks/useSSE')

    useSSE({
      projectId: 'project-1',
      episodeId: 'episode-1',
      enabled: true,
    })

    const source = FakeEventSource.instances[0]
    expect(source).toBeTruthy()

    const event = {
      id: 'dedupe-1',
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: 'task-dedupe-1',
      taskType: 'edit_shot_execution_plan_generate',
      targetType: 'ProjectEditScript',
      targetId: 'edit-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:01.000Z',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
        affectedResources: [
          { kind: 'editShotExecutionPlan', projectId: 'project-1', episodeId: 'episode-1' },
        ],
      },
    }

    source.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, event)
    source.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, event)

    const shotExecutionPlanRefetches = runtime.queryClient.refetchQueries.mock.calls.filter((call) => {
      const arg = (call[0] || {}) as InvalidateArg
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editShotExecutionPlan('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-shot-execution-plan'
        && key[3] === 'episode-1'
        && arg.type === 'active'
    })

    expect(shotExecutionPlanRefetches).toHaveLength(1)
  })

  it('mutation.batch ProjectPanel 事件触发 episode scoped query invalidation', async () => {
    const { useSSE } = await import('@/lib/query/hooks/useSSE')

    useSSE({
      projectId: 'project-1',
      episodeId: 'episode-1',
      enabled: true,
    })

    const source = FakeEventSource.instances[0]
    expect(source).toBeTruthy()

    source.emit(WORKSPACE_SSE_EVENT_TYPE.MUTATION_BATCH, {
      id: 'mb:batch-1',
      type: WORKSPACE_SSE_EVENT_TYPE.MUTATION_BATCH,
      mutationBatchId: 'batch-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:00.000Z',
      operationId: 'update_storyboard_panel_prompt',
      episodeId: 'episode-1',
      targets: [
        { targetType: 'ProjectPanel', targetId: 'panel-1' },
      ],
    })

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

  })

  it('shot execution plan task completion invalidates the persisted shot execution resource', async () => {
    const { useSSE } = await import('@/lib/query/hooks/useSSE')

    useSSE({
      projectId: 'project-1',
      episodeId: 'episode-1',
      enabled: true,
    })

    const source = FakeEventSource.instances[0]
    expect(source).toBeTruthy()

    source.emit(TASK_SSE_EVENT_TYPE.LIFECYCLE, {
      id: '3',
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: 'task-director-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:00.000Z',
      taskType: 'edit_shot_execution_plan_generate',
      targetType: 'ProjectEditScript',
      targetId: 'edit-1',
      episodeId: 'episode-1',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
        episodeId: 'episode-1',
        shotExecutionPlanId: 'execution-1',
        editScriptId: 'edit-1',
        affectedResources: [
          { kind: 'editBible', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'editScript', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'editShotExecutionPlan', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'storyboards', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'episodeData', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'projectContext', projectId: 'project-1', episodeId: 'episode-1' },
          { kind: 'projectData', projectId: 'project-1' },
        ],
      },
    })

    expect(hasInvalidation((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editShotExecutionPlan('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-shot-execution-plan'
        && key[3] === 'episode-1'
    })).toBe(true)
  })
})
