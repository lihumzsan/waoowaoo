import {
  describe,
  expect,
  it,
  join,
  readFileSync,
  resolveWorkspaceAssistantRunFailureDetail,
} from './workspace-assistant-panel.fixture'

describe('workspace assistant panel layout', () => {
  it('shows authoritative failed run details from session-state error fields', () => {
    expect(resolveWorkspaceAssistantRunFailureDetail({
      errorMessage: 'This model is not available in your region.',
      errorCode: 'PROJECT_AGENT_STREAM_FAILED',
      fallback: 'fallback',
    })).toBe('This model is not available in your region.')

    expect(resolveWorkspaceAssistantRunFailureDetail({
      errorMessage: ' ',
      errorCode: 'PROJECT_AGENT_STREAM_FAILED',
      fallback: 'fallback',
    })).toBe('PROJECT_AGENT_STREAM_FAILED')

    expect(resolveWorkspaceAssistantRunFailureDetail({
      errorMessage: null,
      errorCode: null,
      fallback: 'fallback',
    })).toBe('fallback')
  })

  it('keeps style preview loading label scoped to the card namespace in supported locales', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )
    const zhMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/zh/assistantAgent.json'), 'utf8')) as {
      cards: {
        stylePreviewLoading?: string
        stylePreviewConfirmed?: string
      }
    }
    const enMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/en/assistantAgent.json'), 'utf8')) as {
      cards: {
        stylePreviewLoading?: string
        stylePreviewConfirmed?: string
      }
    }

    expect(rendererSource).toContain("t('cards.stylePreviewLoading')")
    expect(rendererSource).not.toContain("t('loading')")
    expect(zhMessages.cards.stylePreviewLoading).toBe('加载中...')
    expect(enMessages.cards.stylePreviewLoading).toBe('Loading...')
    expect(zhMessages.cards.stylePreviewConfirmed).toBe('已确认风格')
    expect(enMessages.cards.stylePreviewConfirmed).toBe('Style confirmed')
  })

  it('keeps project phase card summary free of runtime phase metadata', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )
    const projectPhaseCardSource = rendererSource.slice(
      rendererSource.indexOf('function ProjectPhaseDataCard'),
      rendererSource.indexOf('export function AgentStopDataCard'),
    )
    const zhMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/zh/assistantAgent.json'), 'utf8')) as {
      cards: {
        projectPhase?: string
        runs?: string
      }
    }
    const enMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/en/assistantAgent.json'), 'utf8')) as {
      cards: {
        projectPhase?: string
        runs?: string
      }
    }

    expect(projectPhaseCardSource).toContain("t('cards.projectPhase')")
    expect(projectPhaseCardSource).not.toContain('data.phase')
    expect(projectPhaseCardSource).not.toContain('activePlanRunCount')
    expect(projectPhaseCardSource).not.toContain("t('cards.runs'")
    expect(zhMessages.cards.projectPhase).toBe('项目阶段')
    expect(enMessages.cards.projectPhase).toBe('Project Phase')
    expect(zhMessages.cards.runs).toBeUndefined()
    expect(enMessages.cards.runs).toBeUndefined()
  })

  it('keeps edit script persist stage translated in supported locales', () => {
    const zhProgressSource = readFileSync(join(process.cwd(), 'messages/zh/progress.json'), 'utf8')
    const enProgressSource = readFileSync(join(process.cwd(), 'messages/en/progress.json'), 'utf8')

    expect(zhProgressSource).toContain('"editScriptPersist"')
    expect(enProgressSource).toContain('"editScriptPersist"')
  })

  it('keeps style preview image modal state outside the volatile generation card', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(panelSource).toContain('const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)')
    expect(panelSource).toContain('onPreviewImage: setPreviewImageUrl')
    expect(panelSource).toContain('onPreviewImage={setPreviewImageUrl}')
    expect(panelSource).toContain('<ImagePreviewModal imageUrl={previewImageUrl}')
    expect(rendererSource).toContain('onPreviewImage?: (imageUrl: string) => void')
    expect(rendererSource).toContain('props.onPreviewImage(imageUrl)')
    expect(rendererSource).not.toContain('onClick={() => setPreviewImageUrl(preview.imageUrl)}')
  })

  it('keeps the unified media-generation loading overlay non-interactive and full-cover', () => {
    const overlaySource = readFileSync(
      join(process.cwd(), 'src/components/media/MediaGenerationLoading.tsx'),
      'utf8',
    )

    // 统一加载层覆盖整块媒体区域,且不能拦截指针事件(否则会破坏卡片交互)。
    expect(overlaySource).toContain('pointer-events-none absolute inset-0')
  })
})
