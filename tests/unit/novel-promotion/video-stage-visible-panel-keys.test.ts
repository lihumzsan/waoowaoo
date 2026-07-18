import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { useVideoStageRuntime } from '@/lib/novel-promotion/stages/video-stage-runtime-core'
import type { VideoPanel } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'

const capture = vi.hoisted(() => ({
  visiblePanelKeys: undefined as ReadonlySet<string> | undefined,
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useEffect: () => undefined,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initialValue: T) => [
      initialValue === 1 ? 2 : initialValue,
      vi.fn(),
    ] as const,
  }
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video', () => ({
  VideoToolbar: () => null,
}))

vi.mock('@/components/ui/icons', () => ({ AppIcon: () => null }))
vi.mock('@/components/ui/ImagePreviewModal', () => ({ default: () => null }))
vi.mock('@/components/ui/config-modals/ModelCapabilityDropdown', () => ({
  ModelCapabilityDropdown: () => null,
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/VideoTimelinePanel', () => ({
  default: () => null,
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/FreeVoicePanel', () => ({
  default: () => null,
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/VideoRenderPanel', () => ({
  default: () => null,
}))

vi.mock('@/lib/query/hooks', () => ({
  useDownloadRemoteBlob: () => ({ mutateAsync: vi.fn() }),
  useListProjectEpisodeVideoUrls: () => ({ mutateAsync: vi.fn() }),
  useMatchedVoiceLines: () => ({}),
  useUpdateProjectPanelLink: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/query/hooks/useStoryboards', () => ({
  useLipSync: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoTaskStates', () => ({
  useVideoTaskStates: () => ({
    panelVideoStates: { getTaskState: () => null },
    panelLipStates: { getTaskState: () => null },
    firstLastFramePromptStates: { isFetching: false, getTaskState: () => null },
  }),
}))

const panels = Array.from({ length: 60 }, (_, panelIndex): VideoPanel => ({
  storyboardId: 'story',
  panelIndex,
}))

vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoPanelsProjection', () => ({
  useVideoPanelsProjection: () => ({ allPanels: panels }),
}))
vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoPromptState', () => ({
  useVideoPromptState: () => ({
    savingPrompts: new Set(),
    getLocalPrompt: () => '',
    updateLocalPrompt: vi.fn(),
    savePrompt: vi.fn(),
  }),
}))
vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoPanelLinking', () => ({
  useVideoPanelLinking: () => ({
    linkedPanels: new Map(),
    handleToggleLink: vi.fn(async () => false),
  }),
}))
vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoVoiceLines', () => ({
  useVideoVoiceLines: () => ({
    panelVoiceLines: new Map(),
    allVoiceLines: [],
    runningVoiceLineIds: new Set(),
    reloadVoiceLines: vi.fn(),
  }),
}))
vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoDownloadAll', () => ({
  useVideoDownloadAll: () => ({
    isDownloading: false,
    videosWithUrl: 0,
    handleDownloadAllVideos: vi.fn(),
  }),
}))
vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoStageUiState', () => ({
  useVideoStageUiState: () => ({
    panelVideoPreference: new Map(),
    voiceLinesExpanded: false,
    previewImage: null,
    setPreviewImage: vi.fn(),
    toggleVoiceLinesExpanded: vi.fn(),
    toggleLipSyncVideo: vi.fn(),
    closePreviewImage: vi.fn(),
  }),
}))
vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoPanelViewport', () => ({
  useVideoPanelViewport: () => ({
    panelRefs: { current: new Map() },
    highlightedPanelKey: null,
    locateVoiceLinePanel: vi.fn(),
  }),
}))
vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow', () => ({
  useVideoFirstLastFrameFlow: (params: { visiblePanelKeys?: ReadonlySet<string> }) => {
    capture.visiblePanelKeys = params.visiblePanelKeys
    return {
      flModel: '',
      flModelOptions: [],
      flGenerationOptions: {},
      flGenerationOptionsByPanel: new Map(),
      flCapabilityFields: [],
      flMissingCapabilityFields: [],
      promptEntries: new Map(),
      setFlModel: vi.fn(),
      setFlCapabilityValue: vi.fn(),
      restoreSmartDuration: vi.fn(),
      getFirstLastFrameDurationStatus: () => null,
      setPromptValue: vi.fn(),
      savePromptValue: vi.fn(),
      ensurePrompt: vi.fn(),
      unlinkPrompt: vi.fn(),
      handleGenerateFirstLastFrame: vi.fn(),
      getNextPanel: () => null,
      isLinkedAsLastFrame: () => false,
    }
  },
}))
vi.mock('@/lib/model-capabilities/video-model-options', () => ({
  filterNormalVideoModelOptions: (options: unknown[]) => options,
}))
vi.mock('@/lib/model-capabilities/video-effective', () => ({
  normalizeVideoGenerationSelections: () => ({}),
  resolveEffectiveVideoCapabilityDefinitions: () => [],
  resolveEffectiveVideoCapabilityFields: () => [],
}))
vi.mock('@/lib/model-pricing/video-tier', () => ({
  projectVideoPricingTiersByFixedSelections: () => [],
}))

describe('video stage visible panel keys', () => {
  beforeEach(() => {
    capture.visiblePanelKeys = undefined
    vi.stubGlobal('React', React)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes exactly the second page keys to the first-last-frame prompt flow', () => {
    useVideoStageRuntime({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      clips: [],
      defaultVideoModel: '',
      capabilityOverrides: {},
      onGenerateVideo: vi.fn(async () => undefined),
      onGenerateAllVideos: vi.fn(async () => undefined),
      onBack: vi.fn(),
      onUpdateVideoPrompt: vi.fn(async () => undefined),
      onUpdatePanelVideoModel: vi.fn(async () => undefined),
      onUpdatePanelVideoDurationBinding: vi.fn(async () => undefined),
      onRestorePreviousVideo: vi.fn(async () => undefined),
    })

    const expectedKeys = Array.from({ length: 24 }, (_, index) => `story-${index + 24}`)
    expect(capture.visiblePanelKeys).toEqual(new Set(expectedKeys))
  })
})
