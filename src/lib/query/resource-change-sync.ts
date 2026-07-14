import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from './keys'
import type { WorkspaceResourceRef } from '@/lib/task/types'
import {
  dedupeWorkspaceResourceRefs,
  isWorkspaceResourceName,
  WORKSPACE_RESOURCE_KIND,
} from '@/lib/workspace-resource/resource-impact'

export { isWorkspaceResourceName, WORKSPACE_RESOURCE_KIND }

export type WorkspaceResourceKind = (typeof WORKSPACE_RESOURCE_KIND)[keyof typeof WORKSPACE_RESOURCE_KIND]
export type WorkspaceResourceChange = WorkspaceResourceRef

function queryKeysForResource(ref: WorkspaceResourceRef): QueryKey[] {
  if (ref.kind === WORKSPACE_RESOURCE_KIND.EDIT_BIBLE && ref.episodeId) {
    return [queryKeys.project.editBible(ref.projectId, ref.episodeId)]
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT && ref.episodeId) {
    return [queryKeys.project.editScript(ref.projectId, ref.episodeId)]
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.EDIT_SHOT_EXECUTION_PLAN && ref.episodeId) {
    return [queryKeys.project.editShotExecutionPlan(ref.projectId, ref.episodeId)]
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.VIDEO_SEGMENTS && ref.episodeId) {
    return [queryKeys.videoSegments.all(ref.episodeId)]
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.EPISODE_DATA && ref.episodeId) {
    return [queryKeys.episodeData(ref.projectId, ref.episodeId)]
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT && ref.episodeId) {
    return [queryKeys.project.context(ref.projectId, ref.episodeId)]
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS) {
    const projectAssetKeys: QueryKey[] = [
      queryKeys.assets.all('project', ref.projectId),
      queryKeys.projectAssets.all(ref.projectId),
      queryKeys.projectData(ref.projectId),
    ]
    if (ref.episodeId) {
      projectAssetKeys.push(queryKeys.project.editScript(ref.projectId, ref.episodeId))
      projectAssetKeys.push(queryKeys.episodeData(ref.projectId, ref.episodeId))
      projectAssetKeys.push(queryKeys.project.context(ref.projectId, ref.episodeId))
    }
    return projectAssetKeys
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS) {
    const globalAssetKeys: QueryKey[] = [
      queryKeys.assets.all('global'),
      queryKeys.globalAssets.all(),
      queryKeys.globalAssets.folders(),
    ]
    return globalAssetKeys
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.PROJECT_DATA) {
    return [queryKeys.projectData(ref.projectId)]
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
    for (const queryKey of queryKeysForResource(change)) addQueryKeyOnce(invalidationKeys, queryKey)
  }

  await Promise.all(Array.from(invalidationKeys.values()).map((queryKey) => (
    params.queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
  )))
}
