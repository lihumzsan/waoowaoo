import {
  beforeEach,
  describe,
  expect,
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

  it('allows newer overlay to override completed state for immediate rerun feedback', async () => {
    runtime.apiStates = [
      {
        targetType: 'ProjectPanel',
        targetId: 'panel-2',
        phase: 'completed',
        runningTaskId: null,
        runningTaskType: null,
        intent: 'generate',
        hasOutputAtStart: true,
        progress: 100,
        stage: null,
        stageLabel: null,
        lastError: null,
        updatedAt: '2026-02-27T00:00:00.000Z',
      },
    ]
    runtime.overlayStates = {
      'ProjectPanel:panel-2': {
        targetType: 'ProjectPanel',
        targetId: 'panel-2',
        phase: 'queued',
        runningTaskId: 'task-overlay-new',
        runningTaskType: 'VIDEO_PANEL',
        intent: 'generate',
        hasOutputAtStart: true,
        progress: null,
        stage: null,
        stageLabel: null,
        updatedAt: '2026-02-27T00:00:01.000Z',
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    }

    const { useTaskTargetStateMap } = await import('@/lib/query/hooks/useTaskTargetStateMap')

    const result = useTaskTargetStateMap('project-1', [
      { targetType: 'ProjectPanel', targetId: 'panel-2', types: ['VIDEO_PANEL'] },
    ])

    const state = result.getState('ProjectPanel', 'panel-2')
    expect(state?.phase).toBe('completed')
    expect(state?.runningTaskId).toBeNull()
  })

  it('keeps server terminal state authoritative when overlay is older than completion', async () => {
    runtime.apiStates = [
      {
        targetType: 'ProjectPanel',
        targetId: 'panel-3',
        phase: 'completed',
        runningTaskId: null,
        runningTaskType: null,
        intent: 'generate',
        hasOutputAtStart: true,
        progress: 100,
        stage: null,
        stageLabel: null,
        lastError: null,
        updatedAt: '2026-02-27T00:00:05.000Z',
      },
    ]
    runtime.overlayStates = {
      'ProjectPanel:panel-3': {
        targetType: 'ProjectPanel',
        targetId: 'panel-3',
        phase: 'queued',
        runningTaskId: 'task-overlay-old',
        runningTaskType: 'VIDEO_PANEL',
        intent: 'generate',
        hasOutputAtStart: true,
        progress: null,
        stage: null,
        stageLabel: null,
        updatedAt: '2026-02-27T00:00:01.000Z',
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    }

    const { useTaskTargetStateMap } = await import('@/lib/query/hooks/useTaskTargetStateMap')

    const result = useTaskTargetStateMap('project-1', [
      { targetType: 'ProjectPanel', targetId: 'panel-3', types: ['VIDEO_PANEL'] },
    ])

    const state = result.getState('ProjectPanel', 'panel-3')
    expect(state?.phase).toBe('completed')
    expect(state?.runningTaskId).toBe(null)
    expect(state?.runningTaskType).toBe(null)
  })
})
