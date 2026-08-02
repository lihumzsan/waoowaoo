export const WORKSPACE_ASSISTANT_PANEL_WIDTH_PX = 500
export const WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX = 380
export const WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX = 760

/**
 * 面板把当前宽度写到 root 的这个 CSS 变量上;
 * 画布页 dock(Navbar dockAnchor="assistant-panel")用它贴住面板左缘并跟随拖宽。
 */
export const WORKSPACE_ASSISTANT_PANEL_WIDTH_CSS_VAR = '--workspace-assistant-panel-width'

export interface WorkspaceAssistantPanelLayoutState {
  occupiedWidthPx: number
  panelWidthPx: number
  translateXPx: number
  state: 'expanded'
}

export function clampWorkspaceAssistantPanelWidth(widthPx: number): number {
  return Math.min(
    WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX,
    Math.max(WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX, Math.round(widthPx)),
  )
}

export function buildWorkspaceAssistantPanelLayout(
  expandedWidthPx: number = WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
): WorkspaceAssistantPanelLayoutState {
  const panelWidthPx = clampWorkspaceAssistantPanelWidth(expandedWidthPx)
  return {
    occupiedWidthPx: 0,
    panelWidthPx,
    translateXPx: 0,
    state: 'expanded',
  }
}
