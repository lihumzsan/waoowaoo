import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { syncWorkspaceResourceChanges } from '@/lib/query/resource-change-sync'
import { WORKSPACE_RESOURCE_KIND } from '@/lib/workspace-resource/resource-impact'

describe('Workspace Resource query invalidation', () => {
  it('invalidates every Episode projection when a Project-scope Resource changes', async () => {
    const queryClient = new QueryClient()
    const firstEpisodeKey = queryKeys.project.creativeResources('project-1', 'episode-1')
    const secondEpisodeKey = queryKeys.project.creativeResources('project-1', 'episode-2')
    const otherProjectKey = queryKeys.project.creativeResources('project-2', 'episode-1')
    queryClient.setQueryData(firstEpisodeKey, { resources: [] })
    queryClient.setQueryData(secondEpisodeKey, { resources: [] })
    queryClient.setQueryData(otherProjectKey, { resources: [] })

    await syncWorkspaceResourceChanges({
      queryClient,
      changes: [{
        kind: WORKSPACE_RESOURCE_KIND.CREATIVE_RESOURCES,
        projectId: 'project-1',
        episodeId: null,
      }],
    })

    expect(queryClient.getQueryState(firstEpisodeKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(secondEpisodeKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(otherProjectKey)?.isInvalidated).toBe(false)
  })
})
