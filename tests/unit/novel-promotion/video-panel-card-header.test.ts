import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import VideoPanelCardHeader from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardHeader'
import type { VideoPanelRuntime } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/hooks/useVideoPanelActions'

vi.mock('@/components/task/TaskStatusOverlay', () => ({
  default: () => React.createElement('div', null, 'overlay'),
}))

vi.mock('@/components/media/MediaImageWithLoading', () => ({
  MediaImageWithLoading: () => React.createElement('img', { alt: 'preview' }),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name }: { name: string }) => React.createElement('span', null, name),
}))

function createRuntime(): VideoPanelRuntime {
  return {
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'panelCard.shot') return `Shot ${String(values?.number ?? '')}`
      if (key === 'panelCard.previousVideo') return 'Restore Previous'
      if (key === 'panelCard.download') return 'Download'
      if (key === 'firstLastFrame.linkToNext') return 'link'
      if (key === 'firstLastFrame.unlinkAction') return 'unlink'
      if (key === 'panelCard.original') return 'original'
      if (key === 'panelCard.synced') return 'synced'
      return key
    },
    tCommon: (key: string) => key,
    panel: {
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      panelId: 'panel-2',
      imageUrl: 'https://example.com/frame.jpg',
      videoUrl: 'https://example.com/video.mp4',
      videoGenerationMode: 'normal',
      hasPreviousVideoVersion: true,
      lipSyncVideoUrl: null,
    },
    panelIndex: 2,
    panelKey: 'storyboard-1-2',
    layout: {
      hasNext: false,
      isLinked: false,
      isLastFrame: false,
    },
    media: {
      baseVideoUrl: 'https://example.com/video.mp4',
      currentVideoUrl: 'https://example.com/video.mp4',
      showLipSyncVideo: false,
      onToggleLipSyncVideo: () => undefined,
      onPreviewImage: () => undefined,
    },
    download: {
      canDownloadCurrentVideo: true,
      isDownloadingVideo: false,
    },
    taskStatus: {
      isVideoTaskRunning: false,
      isLipSyncTaskRunning: false,
      panelErrorDisplay: null,
      overlayPresentation: { phase: 'processing' },
    },
    videoModel: {
      selectedModel: 'comfyui::basevideo/test',
      generationOptions: {},
      missingCapabilityFields: [],
    },
    durationBinding: {
      localBinding: {
        mode: 'manual',
        voiceLineIds: [],
      },
    },
    player: {
      cssAspectRatio: '16 / 9',
      isPlaying: false,
      videoRef: { current: null },
      currentVideoUrl: 'https://example.com/video.mp4',
      setIsPlaying: () => undefined,
      handlePlayClick: async () => undefined,
      handlePreviewImage: () => undefined,
    },
    actions: {
      onToggleLink: () => undefined,
      onDownloadVideo: async () => undefined,
      onGenerateVideo: () => undefined,
      onRestorePreviousVideo: () => undefined,
    },
  } as unknown as VideoPanelRuntime
}

describe('VideoPanelCardHeader', () => {
  it('shows previous button when a previous version exists', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardHeader, {
        runtime: createRuntime(),
      }),
    )

    expect(markup).toContain('Restore Previous')
  })

  it('hides previous button when no previous version exists', () => {
    const runtime = createRuntime()
    runtime.panel.hasPreviousVideoVersion = false

    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardHeader, {
        runtime,
      }),
    )

    expect(markup).not.toContain('Restore Previous')
  })
})
