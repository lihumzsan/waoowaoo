import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import VideoPanelCardBody from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardBody'
import type { VideoPanelRuntime } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/hooks/useVideoPanelActions'

vi.mock('@/components/task/TaskStatusInline', () => ({
  default: () => React.createElement('span', null, 'task-status'),
}))

vi.mock('@/components/ui/config-modals/ModelCapabilityDropdown', () => ({
  ModelCapabilityDropdown: (props: {
    capabilityFields: Array<{ field: string; recommendedValue?: unknown }>
  }) => React.createElement('div', null, `model-dropdown${JSON.stringify(props.capabilityFields)}`),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name }: { name: string }) => React.createElement('span', null, name),
}))

function createRuntime(overrides: Partial<VideoPanelRuntime> = {}): VideoPanelRuntime {
  const translate = (key: string, values?: Record<string, unknown>) => {
    if (key === 'firstLastFrame.regenerateVideo') return 'regenerate-first-last-video'
    if (key === 'firstLastFrame.asLastFrameFor') {
      return `作为镜头 ${String(values?.number ?? '')} 的尾帧`
    }
    if (key === 'firstLastFrame.asFirstFrameFor') {
      return `作为镜头 ${String(values?.number ?? '')} 的首帧`
    }
    if (key === 'firstLastFrame.generate') return '生成首尾帧视频'
    if (key === 'firstLastFrame.generated') return '首尾帧视频已生成'
    if (key === 'promptModal.promptLabel') return '视频提示词'
    if (key === 'promptModal.placeholder') return '输入首尾帧视频提示词...'
    if (key === 'panelCard.clickToEditPrompt') return '点击编辑提示词...'
    if (key === 'panelCard.selectModel') return '选择模型'
    if (key === 'panelCard.generateVideo') return '生成视频'
    if (key === 'panelCard.unknownShotType') return '未知镜头'
    if (key === 'stage.hasSynced') return '已生成'
    if (key === 'promptModal.duration') return '秒'
    return key
  }

  const runtime = {
    t: translate,
    tCommon: (key: string) => key,
    panel: {
      storyboardId: 'sb-1',
      panelIndex: 2,
      panelId: 'panel-2',
      imageUrl: 'https://example.com/frame-2.jpg',
      videoUrl: null,
      videoGenerationMode: null,
      lipSyncVideoUrl: null,
      textPanel: {
        shot_type: '平视中景',
        description: '谢俞站在宴席中央',
        duration: 3,
      },
    },
    panelIndex: 2,
    panelKey: 'sb-1-2',
    media: {
      showLipSyncVideo: true,
      onToggleLipSyncVideo: () => undefined,
      onPreviewImage: () => undefined,
      baseVideoUrl: undefined,
      currentVideoUrl: undefined,
    },
    download: {
      canDownloadCurrentVideo: false,
      isDownloadingVideo: false,
    },
    taskStatus: {
      isVideoTaskRunning: false,
      isLipSyncTaskRunning: false,
      taskRunningVideoLabel: '生成中',
      lipSyncInlineState: null,
    },
    videoModel: {
      selectedModel: 'veo-3.1',
      setSelectedModel: () => undefined,
      capabilityFields: [],
      generationOptions: {},
      setCapabilityValue: () => undefined,
      missingCapabilityFields: [],
      videoModelOptions: [],
    },
    durationBinding: {
      localBinding: {
        mode: 'manual',
        voiceLineIds: [],
      },
    },
    player: {
      isPlaying: false,
    },
    promptEditor: {
      isEditing: false,
      editingPrompt: '',
      setEditingPrompt: () => undefined,
      handleStartEdit: () => undefined,
      handleSave: () => undefined,
      handleCancelEdit: () => undefined,
      isSavingPrompt: false,
      localPrompt: '人物从席间回身，接到下一镜头',
    },
    voiceManager: {
      hasMatchedAudio: false,
      hasMatchedVoiceLines: false,
      audioGenerateError: null,
      localVoiceLines: [],
      isVoiceLineTaskRunning: () => false,
      handlePlayVoiceLine: () => undefined,
      handleGenerateAudio: async () => undefined,
      playingVoiceLineId: null,
    },
    lipSync: {
      handleStartLipSync: () => undefined,
      executingLipSync: false,
    },
    layout: {
      isLinked: true,
      isLastFrame: true,
      nextPanel: {
        storyboardId: 'sb-1',
        panelIndex: 3,
        imageUrl: 'https://example.com/frame-3.jpg',
      },
      prevPanel: {
        storyboardId: 'sb-1',
        panelIndex: 1,
        imageUrl: 'https://example.com/frame-1.jpg',
      },
      hasNext: true,
      flModel: 'veo-3.1',
      flModelOptions: [],
      flGenerationOptions: {},
      flCapabilityFields: [],
      flMissingCapabilityFields: [],
      flPromptEntry: {
        value: 'Visible transition prompt',
        origin: 'generated',
        dirty: false,
        status: 'idle',
        ready: true,
      },
      videoRatio: '9:16',
    },
    actions: {
      onGenerateVideo: () => undefined,
      onRestorePreviousVideo: () => undefined,
      onDownloadVideo: () => undefined,
      onUpdatePanelVideoModel: () => undefined,
      onUpdatePanelVideoDurationBinding: () => undefined,
      onToggleLink: () => undefined,
      onFlModelChange: () => undefined,
      onFlCapabilityChange: () => undefined,
      onFlPromptChange: () => undefined,
      onRegenerateFlPrompt: async () => undefined,
      onGenerateFirstLastFrame: () => undefined,
    },
    computed: {
      showLipSyncSection: false,
      canLipSync: false,
      hasVisibleBaseVideo: false,
    },
  }

  return {
    ...runtime,
    ...overrides,
  } as unknown as VideoPanelRuntime
}

describe('VideoPanelCardBody', () => {
  it('renders incoming and outgoing first-last-frame UI for chained panel', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, {
        runtime: createRuntime(),
      }),
    )

    expect(markup).toContain('作为镜头 2 的尾帧')
    expect(markup).toContain('作为镜头 4 的首帧')
    expect(markup).toContain('视频提示词')
    expect(markup).toContain('生成首尾帧视频')
  })

  it('keeps normal-video controls visible for an incoming-only last frame', () => {
    const runtime = createRuntime()
    runtime.layout = {
      ...runtime.layout,
      isLinked: false,
      isLastFrame: true,
      nextPanel: null,
      flPromptEntry: undefined,
    }
    runtime.promptEditor.localPrompt = 'own-normal-video-prompt'
    runtime.t = ((key: string) => key === 'panelCard.generateVideo'
      ? 'generate-normal-video'
      : key) as typeof runtime.t

    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, { runtime }),
    )

    expect(markup).toContain('own-normal-video-prompt')
    expect(markup).toContain('generate-normal-video')
    expect(markup).toContain('model-dropdown')
    expect(markup).not.toContain('firstLastFrame.generate')
  })

  it('passes the recommended duration metadata to the dropdown', () => {
    const runtime = createRuntime()
    runtime.layout = {
      ...runtime.layout,
      isLinked: false,
      isLastFrame: false,
      nextPanel: null,
    }
    runtime.videoModel.capabilityFields = [{
      field: 'duration',
      label: '视频时长',
      options: [9, 5, 10],
      disabledOptions: [],
      value: 9,
      recommendedValue: 9,
    }]

    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, { runtime }),
    )

    expect(markup).toContain('&quot;recommendedValue&quot;:9')
  })

  it('keeps an existing first-last-frame video eligible for regeneration', () => {
    const runtime = createRuntime()
    runtime.panel.videoGenerationMode = 'firstlastframe'
    runtime.panel.videoUrl = 'https://example.com/existing-first-last.mp4'

    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, { runtime }),
    )

    expect(markup).toMatch(/<button(?![^>]*disabled="")[^>]*>regenerate-first-last-video<\/button>/)
  })
  it('shows prompt task state and disables editing and video submission while generation is active', () => {
    const runtime = createRuntime()
    runtime.layout.flPromptEntry = {
      value: 'Keep visible text',
      origin: 'generated',
      dirty: false,
      status: 'processing',
    }

    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, { runtime }),
    )

    expect(markup).toContain('firstLastFrame.promptProcessing')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*><span>edit<\/span><\/button>/)
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>生成首尾帧视频<\/button>/)
  })

  it('shows fallback warning and retry without blocking video submission', () => {
    const runtime = createRuntime()
    runtime.layout.flPromptEntry = {
      value: 'Fallback transition',
      origin: 'generated',
      dirty: false,
      status: 'idle',
      fallbackUsed: true,
      ready: true,
    }

    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, { runtime }),
    )

    expect(markup).toContain('firstLastFrame.promptFallbackWarning')
    expect(markup).toContain('firstLastFrame.retryPrompt')
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>生成首尾帧视频<\/button>/)
  })

  it('blocks video submission for a hard prompt error that is not ready', () => {
    const runtime = createRuntime()
    runtime.layout.flPromptEntry = {
      value: 'Stale prompt',
      origin: 'generated',
      dirty: false,
      status: 'error',
      ready: false,
      errorMessage: 'Prompt generation failed',
    }

    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, { runtime }),
    )

    expect(markup).toMatch(/<button disabled="" class="flex-shrink-0/)
  })

  it('drives linked editing from the prompt entry and disables edit actions while active', () => {
    const runtime = createRuntime()
    runtime.layout.flPromptEntry = {
      value: 'Entry value being edited',
      origin: 'user',
      dirty: true,
      status: 'processing',
    }
    runtime.promptEditor.isEditing = true
    runtime.promptEditor.editingPrompt = 'stale editor copy'

    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, { runtime }),
    )

    expect(markup).toContain('Entry value being edited')
    expect(markup).not.toContain('stale editor copy')
    expect(markup).not.toContain('panelCard.cancel')
    expect(markup).toContain('data-prompt-config-disabled="true"')
    expect(markup.match(/<button[^>]*disabled=""/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('offers manual regenerate for an idle linked prompt', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, { runtime: createRuntime() }),
    )

    expect(markup).toContain('firstLastFrame.regeneratePrompt')
  })
  it('shows long-video guidance and disables generation when linked audio is too long for the selected workflow', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoPanelCardBody, {
        runtime: createRuntime({
          layout: {
            isLinked: false,
            isLastFrame: false,
            nextPanel: null,
            prevPanel: null,
            hasNext: true,
            flModel: '',
            flModelOptions: [],
            flGenerationOptions: {},
            flCapabilityFields: [],
            flMissingCapabilityFields: [],
            flPromptEntry: undefined,
            videoRatio: '9:16',
          },
          durationBinding: {
            localBinding: {
              mode: 'match_audio',
              voiceLineIds: ['line-1'],
            },
            isAudioDriven: true,
            hasValidAudioSelection: false,
            hasAvailableVoiceLines: true,
            availableVoiceLines: [
              {
                id: 'line-1',
                speaker: 'Doctor',
                content: 'long dialogue',
                audioUrl: 'https://example.com/line.mp3',
                audioDuration: 23_700,
              },
            ],
            selectedVoiceLineIds: ['line-1'],
            selectedCount: 1,
            targetDurationOptions: [],
            setLocalBinding: () => undefined,
            timing: {
              canGenerate: false,
              audioDurationSeconds: 23.7,
              maxDurationSeconds: 12,
            },
          },
        } as unknown as Partial<VideoPanelRuntime>),
      }),
    )

    expect(markup).not.toContain('将自动拆成 2 段生成')
    expect(markup).toContain('请切换长视频工作流或拆分音频/镜头后生成')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>生成视频<\/button>/)
  })
})
