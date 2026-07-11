import {
  createProgressTranslator,
  describe,
  expect,
  it,
  join,
  readFileSync,
  renderAssistantToolCallCard,
  resolveProgressStageLabel,
} from './workspace-assistant-panel.fixture'

describe('workspace assistant panel layout', () => {
  it('renders completed tool calls with ok=false as failed instead of successful', () => {
    const html = renderAssistantToolCallCard({
      toolName: 'request_edit_bible_review_choice',
      toolCallId: 'tool-call-choice-1',
      status: { type: 'complete' },
      args: {
        episodeId: 'episode-1',
      },
      result: {
        ok: false,
        error: {
          code: 'OPERATION_EXECUTION_FAILED',
          message: 'PROJECT_AGENT_ACTIVITY_OVERLAP',
        },
      },
    })

    expect(html).toContain('失败 · 确认制作规划')
    expect(html).toContain('操作未能完成，请重试。')
    expect(html).not.toContain('PROJECT_AGENT_ACTIVITY_OVERLAP')
    expect(html).not.toContain('成功 · 确认制作规划')
  })

  it('uses server-side pending approval state instead of reviving persisted approval cards', () => {
    const runtimeSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime.ts'),
      'utf8',
    )

    expect(runtimeSource).not.toContain('pendingApprovalId: findPendingToolApprovalId')
    expect(runtimeSource).toContain('pendingApprovalId: pendingRunApproval?.approvalId ?? null')
  })

  it('never sends raw Assistant transport errors to the composer', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )

    expect(panelSource).toContain("assistantRuntime.error ? t('panel.sendErrorGeneric') : null")
    expect(panelSource).not.toContain('assistantRuntime.error.message ||')
  })

  it('resolves progress stage labels without crashing on missing translations', () => {
    const progressT = createProgressTranslator({
      stage: {
        editScriptPersist: '保存核心剪辑表',
      },
    })

    expect(resolveProgressStageLabel('progress.stage.editScriptPersist', progressT)).toBe('保存核心剪辑表')
    expect(resolveProgressStageLabel('progress.stage.missingStage', progressT)).toBe('MISSING_MESSAGE:progress.stage.missingStage')
    expect(resolveProgressStageLabel('外部阶段', progressT)).toBe('外部阶段')
  })

  it('keeps historical style-generation parts inert and renders the persisted Choice card instead', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(rendererSource).toContain("'edit-style-preview-generation': HiddenRuntimeContextDataCard")
    expect(rendererSource).not.toContain('EditStylePreviewGenerationDataCard')
    expect(rendererSource).not.toContain('refetchInterval')
    expect(rendererSource).not.toContain('useTaskTargetStateMap')
    expect(rendererSource).not.toContain('data.items')
    expect(rendererSource).not.toContain("targetType: 'ProjectEditStylePreview'")
  })
})
