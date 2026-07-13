import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  generateVideoMutateAsyncMock,
  batchGenerateVideosMutateAsyncMock,
  updateProjectPanelVideoPromptMutateAsyncMock,
  updateProjectPanelVideoModelMutateAsyncMock,
  updateProjectPanelVideoDurationBindingMutateAsyncMock,
  restorePreviousProjectPanelVideoMutateAsyncMock,
  updateProjectClipMutateAsyncMock,
} = vi.hoisted(() => ({
  generateVideoMutateAsyncMock: vi.fn(),
  batchGenerateVideosMutateAsyncMock: vi.fn(),
  updateProjectPanelVideoPromptMutateAsyncMock: vi.fn(),
  updateProjectPanelVideoModelMutateAsyncMock: vi.fn(),
  updateProjectPanelVideoDurationBindingMutateAsyncMock: vi.fn(),
  restorePreviousProjectPanelVideoMutateAsyncMock: vi.fn(),
  updateProjectClipMutateAsyncMock: vi.fn(),
}))

vi.mock('@/lib/query/hooks/useStoryboards', () => ({
  useGenerateVideo: () => ({
    mutateAsync: generateVideoMutateAsyncMock,
  }),
  useBatchGenerateVideos: () => ({
    mutateAsync: batchGenerateVideosMutateAsyncMock,
  }),
}))

vi.mock('@/lib/query/hooks', () => ({
  useUpdateProjectPanelVideoPrompt: () => ({
    mutateAsync: updateProjectPanelVideoPromptMutateAsyncMock,
  }),
  useUpdateProjectPanelVideoModel: () => ({
    mutateAsync: updateProjectPanelVideoModelMutateAsyncMock,
  }),
  useUpdateProjectPanelVideoDurationBinding: () => ({
    mutateAsync: updateProjectPanelVideoDurationBindingMutateAsyncMock,
  }),
  useRestorePreviousProjectPanelVideo: () => ({
    mutateAsync: restorePreviousProjectPanelVideoMutateAsyncMock,
  }),
  useUpdateProjectClip: () => ({
    mutateAsync: updateProjectClipMutateAsyncMock,
  }),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { useWorkspaceVideoActions } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceVideoActions'

describe('useWorkspaceVideoActions', () => {
  const originalAlert = globalThis.alert

  beforeEach(() => {
    generateVideoMutateAsyncMock.mockReset()
    batchGenerateVideosMutateAsyncMock.mockReset()
    updateProjectPanelVideoPromptMutateAsyncMock.mockReset()
    updateProjectPanelVideoModelMutateAsyncMock.mockReset()
    updateProjectPanelVideoDurationBindingMutateAsyncMock.mockReset()
    restorePreviousProjectPanelVideoMutateAsyncMock.mockReset()
    updateProjectClipMutateAsyncMock.mockReset()
    globalThis.alert = vi.fn()
  })

  afterEach(() => {
    globalThis.alert = originalAlert
  })

  it('single video mutation fails -> rethrows error for immediate lock cleanup', async () => {
    generateVideoMutateAsyncMock.mockRejectedValueOnce(new Error('video submit failed'))

    const actions = useWorkspaceVideoActions({
      projectId: 'project-1',
      episodeId: 'episode-1',
      t: (key: string) => key,
    })

    await expect(
      actions.handleGenerateVideo('storyboard-1', 0, 'veo-3.1'),
    ).rejects.toThrow('video submit failed')

    expect(globalThis.alert).toHaveBeenCalledWith('execution.generationFailed: video submit failed')
  })

  it('restore previous video mutation forwards panel identity', async () => {
    const actions = useWorkspaceVideoActions({
      projectId: 'project-1',
      episodeId: 'episode-1',
      t: (key: string) => key,
    })

    await actions.handleRestorePreviousVideo('storyboard-1', 3, 'panel-3')

    expect(restorePreviousProjectPanelVideoMutateAsyncMock).toHaveBeenCalledWith({
      panelId: 'panel-3',
      storyboardId: 'storyboard-1',
      panelIndex: 3,
    })
  })

  it('updates the panel video model instead of the project default model', async () => {
    const actions = useWorkspaceVideoActions({
      projectId: 'project-1',
      episodeId: 'episode-1',
      t: (key: string) => key,
    })

    await actions.handleUpdatePanelVideoModel(
      'storyboard-1',
      3,
      'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
    )

    expect(updateProjectPanelVideoModelMutateAsyncMock).toHaveBeenCalledWith({
      storyboardId: 'storyboard-1',
      panelIndex: 3,
      model: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
    })
  })

  it('forwards explicit customPromptEditedByUser state when generating one video', async () => {
    const actions = useWorkspaceVideoActions({
      projectId: 'project-1',
      episodeId: 'episode-1',
      t: (key: string) => key,
    })

    await actions.handleGenerateVideo(
      'storyboard-1',
      2,
      'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      undefined,
      { duration: 12, fps: 25 },
      'panel-3',
      {
        mode: 'match_audio',
        voiceLineIds: ['voice-line-1'],
        targetDurationSeconds: 12,
      },
      'middle-aged doctor speaks calmly to camera',
      false,
    )

    expect(generateVideoMutateAsyncMock).toHaveBeenCalledWith({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      panelId: 'panel-3',
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      firstLastFrame: undefined,
      generationOptions: { duration: 12, fps: 25 },
      videoDurationBinding: {
        mode: 'match_audio',
        voiceLineIds: ['voice-line-1'],
        targetDurationSeconds: 12,
      },
      customPrompt: 'middle-aged doctor speaks calmly to camera',
      customPromptEditedByUser: false,
    })
  })
})
