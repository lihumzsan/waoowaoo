import {
  buildActivity,
  describe,
  expect,
  it,
  join,
  readFileSync,
  resolveWorkspaceAssistantExternalTaskOperationId,
  shouldDockWorkspaceStylePreviewGenerationCard,
  shouldShowWorkspaceAssistantExternalTaskRunCard,
  shouldSuppressWorkspaceAssistantOperationRunCard,
} from './workspace-assistant-panel.fixture'

describe('workspace assistant panel layout', () => {
  it('docks style preview generation only until the user confirms a style', () => {
    expect(shouldDockWorkspaceStylePreviewGenerationCard({
      hasCard: true,
      stylePreviewConfirmed: false,
    })).toBe(true)
    expect(shouldDockWorkspaceStylePreviewGenerationCard({
      hasCard: true,
      stylePreviewConfirmed: true,
    })).toBe(false)
    expect(shouldDockWorkspaceStylePreviewGenerationCard({
      hasCard: false,
      stylePreviewConfirmed: false,
    })).toBe(false)
  })

  it('suppresses only the generic style preview operation card once the docked generation card exists', () => {
    expect(shouldSuppressWorkspaceAssistantOperationRunCard({
      operationId: 'generate_edit_style_previews',
      stylePreviewGenerationDocked: true,
    })).toBe(true)
    expect(shouldSuppressWorkspaceAssistantOperationRunCard({
      operationId: 'generate_edit_script',
      stylePreviewGenerationDocked: true,
    })).toBe(false)
    expect(shouldSuppressWorkspaceAssistantOperationRunCard({
      operationId: 'generate_edit_style_previews',
      stylePreviewGenerationDocked: false,
    })).toBe(false)
  })

  it('shows the active run card only for external task waits', () => {
    expect(shouldShowWorkspaceAssistantExternalTaskRunCard({
      storageLoading: false,
      operationId: 'ingest_script',
      stylePreviewGenerationDocked: false,
    })).toBe(true)
    expect(shouldShowWorkspaceAssistantExternalTaskRunCard({
      storageLoading: false,
      operationId: null,
      stylePreviewGenerationDocked: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantExternalTaskRunCard({
      storageLoading: true,
      operationId: 'ingest_script',
      stylePreviewGenerationDocked: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantExternalTaskRunCard({
      storageLoading: false,
      operationId: 'generate_edit_style_previews',
      stylePreviewGenerationDocked: true,
    })).toBe(false)
  })

  it('renders external task waits from session-state through the unified active-run loading card', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(panelSource).toContain('assistantRuntime.sessionState?.currentActivity')
    expect(panelSource).toContain('resolveWorkspaceAssistantExternalTaskOperationId(currentActivity)')
    expect(panelSource).toContain('showExternalTaskRunCard')
    expect(panelSource).toContain('<WorkspaceAssistantActiveRunCard')
    expect(panelSource).toContain('taskCount={(assistantRuntime.sessionState?.activeTasks ?? []).filter')
    expect(panelSource).not.toContain('<WorkspaceAssistantActiveRunCard operationId={assistantRuntime.pendingOperationId} />')
    expect(panelSource).not.toContain('!assistantRuntime.pendingOperationId')
    expect(rendererSource).toContain("data.reason === 'awaiting_external_task'")

    expect(resolveWorkspaceAssistantExternalTaskOperationId(buildActivity({
      type: 'waiting_task',
      status: 'running',
      operationId: 'generate_edit_script',
      sourceOperationId: null,
    }))).toBe('generate_edit_script')
    expect(resolveWorkspaceAssistantExternalTaskOperationId(buildActivity({
      type: 'waiting_task',
      status: 'waiting',
      operationId: null,
      sourceOperationId: 'generate_edit_shot_execution_plan',
    }))).toBe('generate_edit_shot_execution_plan')
    expect(resolveWorkspaceAssistantExternalTaskOperationId(buildActivity({
      type: 'operation',
      status: 'running',
      operationId: 'get_project_context',
    }))).toBeNull()
    expect(resolveWorkspaceAssistantExternalTaskOperationId(buildActivity({
      type: 'waiting_task',
      status: 'completed',
      operationId: 'generate_edit_script',
    }))).toBeNull()
  })
})
