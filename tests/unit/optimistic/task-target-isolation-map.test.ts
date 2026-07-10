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

  it('matches task type whitelist case-insensitively', async () => {
    runtime.apiStates = [
      {
        targetType: 'ProjectPanel',
        targetId: 'panel-4',
        phase: 'idle',
        runningTaskId: null,
        runningTaskType: null,
        intent: 'generate',
        hasOutputAtStart: null,
        progress: null,
        stage: null,
        stageLabel: null,
        lastError: null,
        updatedAt: null,
      },
    ]
    runtime.overlayStates = {
      'ProjectPanel:panel-4': {
        targetType: 'ProjectPanel',
        targetId: 'panel-4',
        phase: 'processing',
        runningTaskId: 'task-overlay-upper',
        runningTaskType: 'VIDEO_PANEL',
        intent: 'generate',
        hasOutputAtStart: false,
        progress: 15,
        stage: 'generate_panel_video',
        stageLabel: '生成中',
        updatedAt: '2026-02-27T00:00:10.000Z',
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    }

    const { useTaskTargetStateMap } = await import('@/lib/query/hooks/useTaskTargetStateMap')

    const result = useTaskTargetStateMap('project-1', [
      { targetType: 'ProjectPanel', targetId: 'panel-4', types: ['video_panel'] },
    ])

    const state = result.getState('ProjectPanel', 'panel-4')
    expect(state?.phase).toBe('processing')
    expect(state?.runningTaskType).toBe('VIDEO_PANEL')
    expect(state?.runningTaskId).toBe('task-overlay-upper')
  })

  it('keeps states isolated when one target is queried with different task type whitelists', async () => {
    runtime.apiStates = [
      {
        targetType: 'ProjectPanel',
        targetId: 'panel-multi',
        phase: 'processing',
        runningTaskId: 'task-image',
        runningTaskType: 'image_panel',
        intent: 'generate',
        hasOutputAtStart: true,
        progress: 30,
        stage: 'image',
        stageLabel: 'Image',
        lastError: null,
        updatedAt: '2026-02-27T00:00:10.000Z',
      },
      {
        targetType: 'ProjectPanel',
        targetId: 'panel-multi',
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
      'ProjectPanel:panel-multi': {
        targetType: 'ProjectPanel',
        targetId: 'panel-multi',
        phase: 'queued',
        runningTaskId: 'task-overlay-video',
        runningTaskType: 'video_panel',
        intent: 'generate',
        hasOutputAtStart: true,
        progress: null,
        stage: 'video',
        stageLabel: 'Video',
        updatedAt: '2026-02-27T00:00:11.000Z',
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    }

    const { useTaskTargetStateMap } = await import('@/lib/query/hooks/useTaskTargetStateMap')
    const { taskRuntimeTargetQueryKey } = await import('@/lib/task/runtime-targets')

    const imageTarget = { targetType: 'ProjectPanel', targetId: 'panel-multi', types: ['image_panel'] }
    const videoTarget = { targetType: 'ProjectPanel', targetId: 'panel-multi', types: ['video_panel'] }
    const result = useTaskTargetStateMap('project-1', [imageTarget, videoTarget])

    const imageState = result.byQueryKey.get(taskRuntimeTargetQueryKey(imageTarget))
    const videoState = result.byQueryKey.get(taskRuntimeTargetQueryKey(videoTarget))

    expect(imageState?.phase).toBe('processing')
    expect(imageState?.runningTaskType).toBe('image_panel')
    expect(imageState?.runningTaskId).toBe('task-image')
    expect(videoState?.phase).toBe('queued')
    expect(videoState?.runningTaskType).toBe('video_panel')
    expect(videoState?.runningTaskId).toBe('task-overlay-video')
  })
})
