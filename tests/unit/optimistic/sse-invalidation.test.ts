import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, WORKSPACE_SSE_EVENT_TYPE } from '@/lib/task/types'

type InvalidateArg = { queryKey?: readonly unknown[]; exact?: boolean; type?: 'active' | 'all' | 'inactive' }

type EffectCleanup = (() => void) | void | null

const runtime = vi.hoisted(() => ({
  queryClient: {
    invalidateQueries: vi.fn<(arg?: InvalidateArg) => Promise<void>>(async () => undefined),
    refetchQueries: vi.fn<(arg?: InvalidateArg) => Promise<void>>(async () => undefined),
    setQueryData: vi.fn(),
    getQueriesData: vi.fn(() => []),
  },
  effectCleanup: null as EffectCleanup,
  scheduledTimers: [] as Array<() => void>,
  scheduledIntervals: [] as Array<() => void>,
}))

const overlayMock = vi.hoisted(() => ({
  applyTaskLifecycleToOverlay: vi.fn(),
}))

const apiFetchMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}))

class FakeEventSource {
  static OPEN = 1
  static instances: FakeEventSource[] = []

  readonly url: string
  readyState = FakeEventSource.OPEN
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, Set<EventListener>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: EventListener) {
    const set = this.listeners.get(type) || new Set<EventListener>()
    set.add(handler)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, handler: EventListener) {
    const set = this.listeners.get(type)
    if (!set) return
    set.delete(handler)
  }

  emit(type: string, payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent
    if (this.onmessage) this.onmessage(event)
    const set = this.listeners.get(type)
    if (!set) return
    for (const handler of set) {
      handler(event as unknown as Event)
    }
  }

  close() {
    this.readyState = 2
  }
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(value: T) => ({ current: value }),
    useEffect: (effect: () => EffectCleanup) => {
      runtime.effectCleanup = effect()
    },
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => runtime.queryClient,
}))

vi.mock('@/lib/query/task-target-overlay', () => overlayMock)

vi.mock('@/lib/api-fetch', () => apiFetchMock)

function hasInvalidation(predicate: (arg: InvalidateArg) => boolean) {
  return runtime.queryClient.invalidateQueries.mock.calls.some((call) => {
    const arg = (call[0] || {}) as InvalidateArg
    return predicate(arg)
  })
}

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

    expect(runtime.scheduledIntervals).toHaveLength(1)
    runtime.scheduledIntervals[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(apiFetchMock.apiFetch).toHaveBeenCalledWith('/api/sse/replay?projectId=project-1&lastEventId=12&episodeId=episode-1')
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
