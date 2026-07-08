export interface WorkspacePageStateInput {
  projectLoading: boolean
  projectError: string | null
  hasProject: boolean
  isGlobalAssetsView: boolean
  episodeCount: number
  selectedEpisodeId: string | null
  hasCurrentEpisode: boolean
  episodeLoading: boolean
  episodeError: string | null
  projectMissingMessage: string
  episodeMissingMessage: string
}

export type WorkspacePageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' }

export function resolveWorkspacePageState(input: WorkspacePageStateInput): WorkspacePageState {
  if (input.projectLoading) return { kind: 'loading' }
  if (input.projectError) return { kind: 'error', message: input.projectError }
  if (!input.hasProject) return { kind: 'error', message: input.projectMissingMessage }
  if (input.isGlobalAssetsView) return { kind: 'ready' }
  if (input.episodeCount === 0) return { kind: 'ready' }
  if (!input.selectedEpisodeId) return { kind: 'error', message: input.episodeMissingMessage }
  if (input.episodeLoading) return { kind: 'loading' }
  if (input.episodeError) return { kind: 'error', message: input.episodeError }
  if (!input.hasCurrentEpisode) return { kind: 'error', message: input.episodeMissingMessage }
  return { kind: 'ready' }
}
