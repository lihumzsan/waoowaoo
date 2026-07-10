import {
  buildStylePreview,
  buildTaskState,
  createProgressTranslator,
  describe,
  expect,
  it,
  join,
  readFileSync,
  renderAssistantToolCallCard,
  resolveDisplayedEditStylePreviewItems,
  resolveEditStylePreviewCardStatus,
  resolveProgressStageLabel,
  type ProjectEditStylePreview,
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
    expect(html).toContain('PROJECT_AGENT_ACTIVITY_OVERLAP')
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

  it('marks style preview cards as failed when the preview record or task state fails', () => {
    expect(resolveEditStylePreviewCardStatus({
      preview: buildStylePreview({ status: 'failed', errorMessage: 'FAL balance exhausted' }),
      taskState: buildTaskState({ phase: 'processing' }),
    })).toBe('failed')
    expect(resolveEditStylePreviewCardStatus({
      preview: buildStylePreview({ status: 'generating' }),
      taskState: buildTaskState({
        phase: 'failed',
        lastError: {
          code: 'FORBIDDEN',
          message: 'Provider rejected the request',
        },
      }),
    })).toBe('failed')
  })

  it('marks style preview cards as completed only when a completed preview has an image', () => {
    expect(resolveEditStylePreviewCardStatus({
      preview: buildStylePreview({
        status: 'completed',
        imageUrl: 'https://example.test/style.png',
      }),
      taskState: buildTaskState({ phase: 'completed' }),
    })).toBe('completed')
    expect(resolveEditStylePreviewCardStatus({
      preview: buildStylePreview({
        status: 'completed',
        imageUrl: null,
      }),
      taskState: buildTaskState({ phase: 'completed' }),
    })).toBe('generating')
  })

  it('separates style preview loading state from active generation', () => {
    expect(resolveEditStylePreviewCardStatus({
      preview: null,
      taskState: undefined,
      loading: true,
    })).toBe('loading')
  })

  it('shows only the confirmed style preview after a visual style is selected', () => {
    const items = [
      {
        id: 'preview-a',
        styleKey: 'style_a',
        title: 'Style A',
        summary: 'A',
        taskId: 'task-a',
        aspectRatio: '16:9',
      },
      {
        id: 'preview-b',
        styleKey: 'style_b',
        title: 'Style B',
        summary: 'B',
        taskId: 'task-b',
        aspectRatio: '16:9',
      },
      {
        id: 'preview-c',
        styleKey: 'style_c',
        title: 'Style C',
        summary: 'C',
        taskId: 'task-c',
        aspectRatio: '16:9',
      },
    ] satisfies Parameters<typeof resolveDisplayedEditStylePreviewItems>[0]['items']
    const previewsById = new Map<string, ProjectEditStylePreview>([
      ['preview-a', buildStylePreview({ id: 'preview-a', status: 'completed' })],
      ['preview-b', buildStylePreview({ id: 'preview-b', status: 'confirmed' })],
      ['preview-c', buildStylePreview({ id: 'preview-c', status: 'completed' })],
    ])

    expect(resolveDisplayedEditStylePreviewItems({ items, previewsById })).toEqual([
      {
        id: 'preview-b',
        styleKey: 'style_b',
        title: 'Style B',
        summary: 'B',
        taskId: 'task-b',
        aspectRatio: '16:9',
      },
    ])
  })
})
