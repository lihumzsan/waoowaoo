import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from './keys'
import type { WorkspaceResourceRef } from '@/lib/task/types'
import {
  dedupeWorkspaceResourceRefs,
  isWorkspaceResourceName,
} from '@/lib/workspace-resource/resource-impact'

export { isWorkspaceResourceName }

export type WorkspaceResourceKind = WorkspaceResourceRef['kind']
export type WorkspaceResourceChange = WorkspaceResourceRef

function queryKeysForResource(ref: WorkspaceResourceRef): QueryKey[] {
  if (ref.kind === 'globalAssets') {
    const globalAssetKeys: QueryKey[] = [
      queryKeys.assets.all(),
      queryKeys.globalAssets.all(),
      queryKeys.globalAssets.folders(),
    ]
    return globalAssetKeys
  }

  if (ref.kind === 'projectData') {
    return [queryKeys.projectData(ref.projectId)]
  }

  if (ref.kind === 'workspaceResources') {
    return [queryKeys.project.workspaceResourcesAll(ref.projectId)]
  }

  return []
}

function addQueryKeyOnce(target: Map<string, QueryKey>, queryKey: QueryKey): void {
  target.set(JSON.stringify(queryKey), queryKey)
}

export async function syncWorkspaceResourceChanges(params: {
  queryClient: QueryClient
  changes: readonly WorkspaceResourceChange[]
}) {
  const changes = dedupeWorkspaceResourceRefs(params.changes)
  const invalidationKeys = new Map<string, QueryKey>()

  for (const change of changes) {
    addQueryKeyOnce(invalidationKeys, queryKeys.operationPlans.all(change.projectId))
    for (const queryKey of queryKeysForResource(change)) addQueryKeyOnce(invalidationKeys, queryKey)
  }

  await Promise.all(Array.from(invalidationKeys.values()).map((queryKey) => (
    params.queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
  )))
}
