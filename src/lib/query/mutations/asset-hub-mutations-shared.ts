import type { QueryClient } from '@tanstack/react-query'
import { syncWorkspaceResourceChanges } from '../resource-change-sync'
import {
  GLOBAL_ASSET_PROJECT_ID,
  resolveWorkspaceResourceRefs,
  WORKSPACE_RESOURCE_IMPACT,
} from '@/lib/workspace-resource/resource-impact'

export { GLOBAL_ASSET_PROJECT_ID }

export function invalidateGlobalCharacters(queryClient: QueryClient) {
  return syncWorkspaceResourceChanges({
    queryClient,
    changes: resolveWorkspaceResourceRefs({
      impact: WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS,
      projectId: GLOBAL_ASSET_PROJECT_ID,
      episodeId: null,
    }),
  })
}

export function invalidateGlobalLocations(queryClient: QueryClient) {
  return syncWorkspaceResourceChanges({
    queryClient,
    changes: resolveWorkspaceResourceRefs({
      impact: WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS,
      projectId: GLOBAL_ASSET_PROJECT_ID,
      episodeId: null,
    }),
  })
}
