import {
  describe,
  expect,
  it,
  join,
  readFileSync,
  resolveWorkspaceAssistantRunFailureDetail,
} from './workspace-assistant-panel.fixture'

describe('workspace assistant panel layout', () => {
  it('shows only localized failed run details and never exposes raw server errors', () => {
    expect(resolveWorkspaceAssistantRunFailureDetail({
      localizedError: 'Localized provider error',
      fallback: 'fallback',
    })).toBe('Localized provider error')

    expect(resolveWorkspaceAssistantRunFailureDetail({
      localizedError: ' ',
      fallback: 'fallback',
    })).toBe('fallback')

    expect(resolveWorkspaceAssistantRunFailureDetail({
      localizedError: null,
      fallback: 'fallback',
    })).toBe('fallback')
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

  it('does not restore a style-preview modal or generation-card lifecycle beside the persisted Choice card', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(panelSource).not.toContain('previewImageUrl')
    expect(panelSource).not.toContain('setPreviewImageUrl')
    expect(panelSource).not.toContain('<ImagePreviewModal')
    expect(rendererSource).toContain("'edit-style-preview-generation': HiddenRuntimeContextDataCard")
    expect(rendererSource).not.toContain('onPreviewImage')
    expect(rendererSource).not.toContain('EditStylePreviewGenerationDataCard')
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
