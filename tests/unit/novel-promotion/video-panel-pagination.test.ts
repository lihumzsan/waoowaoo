import React, { type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import VideoRenderPanel from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/VideoRenderPanel'
import type { VideoPanel } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import {
  VIDEO_PANEL_PAGE_SIZE,
  getVideoPanelPage,
  paginateVideoPanels,
} from '@/lib/novel-promotion/stages/video-stage-runtime/video-panel-pagination'

vi.stubGlobal('React', React)

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (
    values ? `${key}:${JSON.stringify(values)}` : key
  ),
}))

vi.mock('@/lib/constants', () => ({
  getAspectRatioConfig: () => ({ isVertical: false }),
}))

vi.mock('@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry', () => ({
  resolvePanelFirstLastFrameGenerationOptions: () => ({}),
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video', () => ({
  VideoPanelCard: ({ panel, panelIndex, prevPanel, nextPanel, hasNext, isLastFrame }: {
    panel: VideoPanel
    panelIndex: number
    prevPanel: VideoPanel | null
    nextPanel: VideoPanel | null
    hasNext: boolean
    isLastFrame: boolean
  }) => React.createElement('article', {
    'data-panel-key': `${panel.storyboardId}-${panel.panelIndex}`,
    'data-global-index': panelIndex,
    'data-prev-index': prevPanel?.panelIndex,
    'data-next-index': nextPanel?.panelIndex,
    'data-has-next': String(hasNext),
    'data-is-last-frame': String(isLastFrame),
  }),
}))

const panels = Array.from({ length: 60 }, (_, panelIndex) => ({
  storyboardId: 'story',
  panelIndex,
}))

describe('video panel pagination', () => {
  it('returns at most 24 panels for the requested page', () => {
    const page = paginateVideoPanels(panels, 1)

    expect(VIDEO_PANEL_PAGE_SIZE).toBe(24)
    expect(page.items).toHaveLength(24)
    expect(page.items[0]?.panelIndex).toBe(0)
    expect(page.items[23]?.panelIndex).toBe(23)
  })

  it('keeps the global start index for panel semantics', () => {
    const page = paginateVideoPanels(panels, 2)

    expect(page.startIndex).toBe(24)
    expect(page.items[0]?.panelIndex).toBe(24)
  })

  it('finds the page containing a panel key', () => {
    expect(getVideoPanelPage(panels, 'story-49')).toBe(3)
  })

  it('mounts only the requested page while preserving global neighbor indexes', () => {
    const linkedGlobalIndexes = new Set([23])
    const getNextPanel = vi.fn((index: number) => (
      (panels[index + 1] as VideoPanel | undefined) || null
    ))
    const isLinkedAsLastFrame = vi.fn((index: number) => linkedGlobalIndexes.has(index - 1))
    const props = {
      allPanels: panels as VideoPanel[],
      currentPage: 2,
      onPageChange: vi.fn(),
      linkedPanels: new Map(),
      highlightedPanelKey: null,
      panelRefs: { current: new Map() },
      videoRatio: '16:9',
      defaultVideoModel: '',
      capabilityOverrides: {},
      projectId: 'project-1',
      episodeId: 'episode-1',
      runningVoiceLineIds: new Set(),
      panelVoiceLines: new Map(),
      panelVideoPreference: new Map(),
      savingPrompts: new Set(),
      flModel: '',
      flModelOptions: [],
      flGenerationOptions: {},
      flGenerationOptionsByPanel: new Map(),
      flCapabilityFields: [],
      flMissingCapabilityFields: [],
      promptEntries: new Map(),
      onGenerateVideo: vi.fn(),
      onUpdatePanelVideoModel: vi.fn(),
      onUpdatePanelVideoDurationBinding: vi.fn(),
      onRestorePreviousVideo: vi.fn(),
      onLipSync: vi.fn(),
      onToggleLink: vi.fn(),
      onFlModelChange: vi.fn(),
      onFlCapabilityChange: vi.fn(),
      onRestoreFlSmartDuration: vi.fn(),
      onFlPromptChange: vi.fn(),
      onSaveFlPrompt: vi.fn(),
      onRegenerateFlPrompt: vi.fn(),
      onGenerateFirstLastFrame: vi.fn(),
      onPreviewImage: vi.fn(),
      onToggleLipSyncVideo: vi.fn(),
      getNextPanel,
      isLinkedAsLastFrame,
      getFirstLastFrameDurationStatus: () => null,
      getLocalPrompt: () => '',
      updateLocalPrompt: vi.fn(),
      savePrompt: vi.fn(),
    } as unknown as ComponentProps<typeof VideoRenderPanel>

    const markup = renderToStaticMarkup(React.createElement(VideoRenderPanel, props))
    const mountedCards = markup.match(/<article/g) || []

    expect(mountedCards).toHaveLength(24)
    expect(markup).toContain('data-global-index="24"')
    expect(markup).toContain('data-prev-index="23"')
    expect(markup).toMatch(/data-global-index="24"[^>]*data-is-last-frame="true"/)
    expect(markup).toContain('data-global-index="47"')
    expect(markup).toContain('data-next-index="48"')
    expect(markup).not.toContain('data-global-index="0"')
    expect(getNextPanel).toHaveBeenCalledWith(24)
    expect(getNextPanel).toHaveBeenCalledWith(47)
    expect(getNextPanel).not.toHaveBeenCalledWith(0)
    expect(isLinkedAsLastFrame).toHaveBeenCalledWith(24)
    expect(isLinkedAsLastFrame).toHaveBeenCalledWith(47)
    expect(isLinkedAsLastFrame).not.toHaveBeenCalledWith(0)
    expect(markup).toContain('content-visibility:auto')
    expect(markup).toContain('contain-intrinsic-size:0 720px')
  })
})
