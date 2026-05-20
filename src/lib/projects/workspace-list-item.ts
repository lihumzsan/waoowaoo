export interface WorkspaceProjectStats {
  episodes: number
  images: number
  videos: number
  panels: number
  firstEpisodePreview: string | null
}

export interface WorkspaceProjectListItem {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  totalCost?: number
  stats?: WorkspaceProjectStats
}

export type WorkspaceProjectUpdatePayload = Omit<WorkspaceProjectListItem, 'stats' | 'totalCost'> &
  Partial<Pick<WorkspaceProjectListItem, 'stats' | 'totalCost'>>

export function mergeWorkspaceProjectListItemUpdate(
  current: WorkspaceProjectListItem,
  updated: WorkspaceProjectUpdatePayload,
): WorkspaceProjectListItem {
  return {
    ...current,
    ...updated,
    stats: updated.stats ?? current.stats,
    totalCost: updated.totalCost ?? current.totalCost,
  }
}
