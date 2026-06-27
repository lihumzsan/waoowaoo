export const WORKSPACE_ASSISTANT_PANEL_WIDTH_PX = 500
export const WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX = 380
export const WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX = 760
export const WORKSPACE_ASSISTANT_TOP_OFFSET = '6rem'

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
