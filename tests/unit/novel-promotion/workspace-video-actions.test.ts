import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  generateVideoMutateAsyncMock,
  batchGenerateVideosMutateAsyncMock,
  updateProjectPanelVideoPromptMutateAsyncMock,
  updateProjectPanelVideoDurationBindingMutateAsyncMock,
  restorePreviousProjectPanelVideoMutateAsyncMock,
  updateProjectClipMutateAsyncMock,
  updateProjectConfigMutateAsyncMock,
} = vi.hoisted(() => ({
  generateVideoMutateAsyncMock: vi.fn(),
  batchGenerateVideosMutateAsyncMock: vi.fn(),
  updateProjectPanelVideoPromptMutateAsyncMock: vi.fn(),
  updateProjectPanelVideoDurationBindingMutateAsyncMock: vi.fn(),
  restorePreviousProjectPanelVideoMutateAsyncMock: vi.fn(),
  updateProjectClipMutateAsyncMock: vi.fn(),
  updateProjectConfigMutateAsyncMock: vi.fn(),
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
  useUpdateProjectPanelVideoDurationBinding: () => ({
    mutateAsync: updateProjectPanelVideoDurationBindingMutateAsyncMock,
  }),
  useRestorePreviousProjectPanelVideo: () => ({
    mutateAsync: restorePreviousProjectPanelVideoMutateAsyncMock,
  }),
  useUpdateProjectClip: () => ({
    mutateAsync: updateProjectClipMutateAsyncMock,
  }),
  useUpdateProjectConfig: () => ({
    mutateAsync: updateProjectConfigMutateAsyncMock,
  }),
}))

import { useWorkspaceVideoActions } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceVideoActions'

describe('useWorkspaceVideoActions', () => {
  const originalAlert = globalThis.alert

  beforeEach(() => {
    generateVideoMutateAsyncMock.mockReset()
    batchGenerateVideosMutateAsyncMock.mockReset()
    updateProjectPanelVideoPromptMutateAsyncMock.mockReset()
    updateProjectPanelVideoDurationBindingMutateAsyncMock.mockReset()
    restorePreviousProjectPanelVideoMutateAsyncMock.mockReset()
    updateProjectClipMutateAsyncMock.mockReset()
    updateProjectConfigMutateAsyncMock.mockReset()
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
})
