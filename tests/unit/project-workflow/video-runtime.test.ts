import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filterNormalVideoModelOptions, isFirstLastFrameOnlyModel, supportsFirstLastFrame } from '@/lib/ai-registry/video-capabilities'
import type { WorkspaceVideoGenerationModelOption } from '@/features/project-workspace/video-generation-types'
import { useWorkspaceVideoActions } from '@/features/project-workspace/hooks/useWorkspaceVideoActions'

const {
  generateVideoMutateAsyncMock,
  batchGenerateVideosMutateAsyncMock,
  updateProjectPanelVideoPromptMutateAsyncMock,
  updateProjectClipMutateAsyncMock,
  updateProjectConfigMutateAsyncMock,
} = vi.hoisted(() => ({
  generateVideoMutateAsyncMock: vi.fn(),
  batchGenerateVideosMutateAsyncMock: vi.fn(),
  updateProjectPanelVideoPromptMutateAsyncMock: vi.fn(),
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
  useGenerateBgmScore: () => ({
    mutateAsync: vi.fn(),
  }),
  useRenderFinalVideo: () => ({
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/lib/query/hooks', () => ({
  useUpdateProjectPanelVideoPrompt: () => ({
    mutateAsync: updateProjectPanelVideoPromptMutateAsyncMock,
  }),
  useUpdateProjectClip: () => ({
    mutateAsync: updateProjectClipMutateAsyncMock,
  }),
  useUpdateProjectConfig: () => ({
    mutateAsync: updateProjectConfigMutateAsyncMock,
  }),
}))

describe('video model options partition', () => {
  const models: WorkspaceVideoGenerationModelOption[] = [
    {
      value: 'p::normal',
      label: 'normal',
      capabilities: {
        video: {
          generationModeOptions: ['normal'],
          firstlastframe: false,
        },
      },
    },
    {
      value: 'p::firstlast-only',
      label: 'firstlast-only',
      capabilities: {
        video: {
          generationModeOptions: ['firstlastframe'],
          firstlastframe: true,
        },
      },
    },
    {
      value: 'p::both',
      label: 'both',
      capabilities: {
        video: {
          generationModeOptions: ['normal', 'firstlastframe'],
          firstlastframe: true,
        },
      },
    },
    {
      value: 'p::custom-no-capability',
      label: 'custom-no-capability',
    },
  ]

  it('detects firstlastframe support and firstlastframe-only capability', () => {
    expect(supportsFirstLastFrame(models[0])).toBe(false)
    expect(supportsFirstLastFrame(models[1])).toBe(true)
    expect(supportsFirstLastFrame(models[2])).toBe(true)
    expect(supportsFirstLastFrame(models[3])).toBe(false)

    expect(isFirstLastFrameOnlyModel(models[0])).toBe(false)
    expect(isFirstLastFrameOnlyModel(models[1])).toBe(true)
    expect(isFirstLastFrameOnlyModel(models[2])).toBe(false)
    expect(isFirstLastFrameOnlyModel(models[3])).toBe(false)
  })

  it('filters out firstlastframe-only models from normal video model list', () => {
    const normalModels = filterNormalVideoModelOptions(models)
    expect(normalModels.map((item) => item.value)).toEqual([
      'p::normal',
      'p::both',
      'p::custom-no-capability',
    ])
  })
})

describe('useWorkspaceVideoActions', () => {
  const originalAlert = globalThis.alert

  beforeEach(() => {
    generateVideoMutateAsyncMock.mockReset()
    batchGenerateVideosMutateAsyncMock.mockReset()
    updateProjectPanelVideoPromptMutateAsyncMock.mockReset()
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
      singleShotVideoModel: 'veo-3.1',
    })

    await expect(
      actions.handleGenerateVideo('storyboard-1', 0),
    ).rejects.toThrow('video submit failed')

    expect(globalThis.alert).toHaveBeenCalledWith('execution.generationFailed: video submit failed')
  })
})
