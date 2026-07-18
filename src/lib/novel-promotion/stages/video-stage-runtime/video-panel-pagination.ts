export const VIDEO_PANEL_PAGE_SIZE = 24

interface VideoPanelIdentity {
  storyboardId: string
  panelIndex: number
}

export interface VideoPanelPage<T> {
  items: T[]
  page: number
  totalPages: number
  startIndex: number
}

export function paginateVideoPanels<T>(panels: T[], requestedPage: number): VideoPanelPage<T> {
  const totalPages = Math.max(1, Math.ceil(panels.length / VIDEO_PANEL_PAGE_SIZE))
  const page = Math.min(Math.max(Math.trunc(requestedPage), 1), totalPages)
  const startIndex = (page - 1) * VIDEO_PANEL_PAGE_SIZE

  return {
    items: panels.slice(startIndex, startIndex + VIDEO_PANEL_PAGE_SIZE),
    page,
    totalPages,
    startIndex,
  }
}

export function getVideoPanelPage(
  panels: readonly VideoPanelIdentity[],
  panelKey: string,
): number {
  const panelIndex = panels.findIndex(
    (panel) => `${panel.storyboardId}-${panel.panelIndex}` === panelKey,
  )
  return panelIndex < 0 ? 1 : Math.floor(panelIndex / VIDEO_PANEL_PAGE_SIZE) + 1
}
