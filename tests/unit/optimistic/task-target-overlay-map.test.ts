import {
  beforeEach,
  describe,
  expect,
  findTargetStatesQueryCall,
  it,
  overlayNow,
  runtime,
  vi,
} from './task-target-state-map.fixture'

describe('task target state map behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.useQueryCalls = []
    runtime.apiStates = [
      {
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
        phase: 'idle',
        runningTaskId: null,
        runningTaskType: null,
        intent: 'process',
        hasOutputAtStart: null,
        progress: null,
        stage: null,
        stageLabel: null,
        lastError: null,
        updatedAt: null,
      },
      {
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        phase: 'processing',
        runningTaskId: 'task-api-panel',
        runningTaskType: 'IMAGE_PANEL',
        intent: 'process',
        hasOutputAtStart: null,
        progress: 10,
        stage: 'api',
        stageLabel: 'API处理中',
        lastError: null,
        updatedAt: overlayNow,
      },
    ]
    runtime.overlayStates = {
      'CharacterAppearance:appearance-1': {
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
        phase: 'processing',
        runningTaskId: 'task-ov-1',
        runningTaskType: 'IMAGE_CHARACTER',
        intent: 'process',
        hasOutputAtStart: false,
        progress: 50,
        stage: 'generate',
        stageLabel: '生成中',
        updatedAt: overlayNow,
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
      'ProjectPanel:panel-1': {
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        phase: 'queued',
        runningTaskId: 'task-ov-2',
        runningTaskType: 'VIDEO_PANEL',
        intent: 'process',
        hasOutputAtStart: null,
        progress: null,
        stage: null,
        stageLabel: null,
        updatedAt: overlayNow,
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    }
  })

  it('keeps polling disabled and merges overlay only when rules match', async () => {
    const { useTaskTargetStateMap } = await import('@/lib/query/hooks/useTaskTargetStateMap')

    const result = useTaskTargetStateMap('project-1', [
      { targetType: 'CharacterAppearance', targetId: 'appearance-1', types: ['IMAGE_CHARACTER'] },
      { targetType: 'ProjectPanel', targetId: 'panel-1', types: ['IMAGE_PANEL'] },
    ])

    const firstCall = findTargetStatesQueryCall()
    expect(firstCall?.refetchInterval).toBe(false)

    const appearance = result.getState('CharacterAppearance', 'appearance-1')
    expect(appearance?.phase).toBe('processing')
    expect(appearance?.runningTaskType).toBe('IMAGE_CHARACTER')
    expect(appearance?.runningTaskId).toBe('task-ov-1')

    const panel = result.getState('ProjectPanel', 'panel-1')
    expect(panel?.phase).toBe('processing')
    expect(panel?.runningTaskType).toBe('IMAGE_PANEL')
    expect(panel?.runningTaskId).toBe('task-api-panel')
  })

  it('keeps overlay running state authoritative without polling when server state is still idle', async () => {
    runtime.apiStates = [
      {
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        phase: 'idle',
        runningTaskId: null,
        runningTaskType: null,
        intent: 'process',
        hasOutputAtStart: null,
        progress: null,
        stage: null,
        stageLabel: null,
        lastError: null,
        updatedAt: null,
      },
    ]
    runtime.overlayStates = {
      'ProjectVideoGroup:group-1': {
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        phase: 'processing',
        runningTaskId: 'task-overlay-video-group',
        runningTaskType: 'video_group',
        intent: 'generate',
        hasOutputAtStart: true,
        progress: 47,
        stage: 'polling_external',
        stageLabel: 'Polling external task',
        updatedAt: overlayNow,
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    }

    const { useTaskTargetStateMap } = await import('@/lib/query/hooks/useTaskTargetStateMap')

    const result = useTaskTargetStateMap('project-1', [
      { targetType: 'ProjectVideoGroup', targetId: 'group-1', types: ['video_group'] },
    ])

    const firstCall = findTargetStatesQueryCall()
    expect(firstCall?.refetchInterval).toBe(false)
    const state = result.getState('ProjectVideoGroup', 'group-1')
    expect(state?.phase).toBe('processing')
    expect(state?.runningTaskId).toBe('task-overlay-video-group')
  })
})
