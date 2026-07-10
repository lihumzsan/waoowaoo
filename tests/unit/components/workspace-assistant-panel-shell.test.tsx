import {
  WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX,
  WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX,
  WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
  WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS,
  WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE,
  buildWorkspaceAssistantPanelLayout,
  clampWorkspaceAssistantPanelWidth,
  describe,
  expect,
  it,
  join,
  readFileSync,
} from './workspace-assistant-panel.fixture'

describe('workspace assistant panel layout', () => {
  it('returns expanded width when panel is visible', () => {
    expect(buildWorkspaceAssistantPanelLayout()).toEqual({
      occupiedWidthPx: 0,
      panelWidthPx: WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
      translateXPx: 0,
      state: 'expanded',
    })
  })

  it('clamps custom expanded width into the supported resize range', () => {
    expect(buildWorkspaceAssistantPanelLayout(640)).toEqual({
      occupiedWidthPx: 0,
      panelWidthPx: 640,
      translateXPx: 0,
      state: 'expanded',
    })
    expect(clampWorkspaceAssistantPanelWidth(200)).toBe(WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX)
    expect(clampWorkspaceAssistantPanelWidth(1200)).toBe(WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX)
  })

  it('keeps the assistant panel fixed open without collapse rail controls', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const layoutSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/panel-layout.ts'),
      'utf8',
    )

    expect(panelSource).not.toContain('WorkspaceAssistantCollapseHandle')
    expect(panelSource).not.toContain('WorkspaceAssistantPanelRail')
    expect(panelSource).not.toContain('onToggleCollapsed')
    expect(panelSource).not.toContain('isCollapsed')
    expect(layoutSource).not.toContain('WORKSPACE_ASSISTANT_RAIL_WIDTH_PX')
    expect(layoutSource).not.toContain("'collapsed'")
  })

  it('keeps user messages as flat gray bubbles without border or shadow', () => {
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).toContain('bg-neutral-100')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('border')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('shadow')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('backdrop-blur')
  })

  it('fades scrolled messages near the top boundary instead of clipping them hard', () => {
    expect(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.maskImage).toBe(
      'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
    )
    expect(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.WebkitMaskImage).toBe(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.maskImage)
  })

  it('does not reserve inline space for a collapse control', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )

    expect(panelSource).not.toContain('float-right h-14 w-14')
    expect(panelSource).not.toContain('pr-16')
  })

  it('keeps SDK tool approval actions in the message stream without a duplicate pending action summary', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(panelSource).not.toContain('pendingActionsTitle')
    expect(panelSource).not.toContain('pendingConfirmationChip')
    expect(rendererSource).toContain('ToolCallMessagePartProps')
    expect(rendererSource).toContain("toolStatus === 'requires-action'")
    expect(rendererSource).toContain('ConfirmationActionCard')
  })
})
