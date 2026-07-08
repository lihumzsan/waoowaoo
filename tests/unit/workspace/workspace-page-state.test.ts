import { describe, expect, it } from 'vitest'
import { resolveWorkspacePageState, type WorkspacePageStateInput } from '@/app/[locale]/workspace/[projectId]/workspace-page-state'

const baseInput: WorkspacePageStateInput = {
  projectLoading: false,
  projectError: null,
  hasProject: true,
  isGlobalAssetsView: false,
  episodeCount: 1,
  selectedEpisodeId: 'episode-1',
  hasCurrentEpisode: true,
  episodeLoading: false,
  episodeError: null,
  projectMissingMessage: 'Project missing',
  episodeMissingMessage: 'Episode missing',
}

describe('resolveWorkspacePageState', () => {
  it('returns error instead of infinite loading when the selected episode query fails', () => {
    const state = resolveWorkspacePageState({
      ...baseInput,
      hasCurrentEpisode: false,
      episodeError: 'Failed to load episode',
    })

    expect(state).toEqual({ kind: 'error', message: 'Failed to load episode' })
  })

  it('keeps loading while the selected episode query is still in flight', () => {
    const state = resolveWorkspacePageState({
      ...baseInput,
      hasCurrentEpisode: false,
      episodeLoading: true,
    })

    expect(state).toEqual({ kind: 'loading' })
  })

  it('returns error when a project has episodes but no current episode can be resolved', () => {
    const state = resolveWorkspacePageState({
      ...baseInput,
      selectedEpisodeId: null,
      hasCurrentEpisode: false,
    })

    expect(state).toEqual({ kind: 'error', message: 'Episode missing' })
  })

  it('returns project error when the project query has completed without a project', () => {
    const state = resolveWorkspacePageState({
      ...baseInput,
      hasProject: false,
      hasCurrentEpisode: false,
    })

    expect(state).toEqual({ kind: 'error', message: 'Project missing' })
  })
})
