import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from './keys'
import type { WorkspaceResourceRef } from '@/lib/task/types'
import {
  dedupeWorkspaceResourceRefs,
  extractWorkspaceResourceRefsFromWriteResult,
  isWorkspaceResourceName,
  WORKSPACE_RESOURCE_KIND,
} from '@/lib/workspace-resource/resource-impact'

export { isWorkspaceResourceName, WORKSPACE_RESOURCE_KIND }

export type WorkspaceResourceKind = (typeof WORKSPACE_RESOURCE_KIND)[keyof typeof WORKSPACE_RESOURCE_KIND]
export type WorkspaceResourceChange = WorkspaceResourceRef

type ResourceSyncPolicy = {
  invalidate: QueryKey[]
  refetchActive: QueryKey[]
}

function policyForResource(ref: WorkspaceResourceRef): ResourceSyncPolicy {
  if (ref.kind === WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY && ref.episodeId) {
    const queryKey = queryKeys.project.editScreenplay(ref.projectId, ref.episodeId)
    return { invalidate: [queryKey], refetchActive: [queryKey] }
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT && ref.episodeId) {
    const queryKey = queryKeys.project.editScript(ref.projectId, ref.episodeId)
    return { invalidate: [queryKey], refetchActive: [queryKey] }
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.EDIT_SHOT_EXECUTION_PLAN && ref.episodeId) {
    const queryKey = queryKeys.project.editShotExecutionPlan(ref.projectId, ref.episodeId)
    return { invalidate: [queryKey], refetchActive: [queryKey] }
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.STORYBOARDS && ref.episodeId) {
    const queryKey = queryKeys.storyboards.all(ref.episodeId)
    return { invalidate: [queryKey], refetchActive: [queryKey] }
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.VIDEOS && ref.episodeId) {
    const allVideos = queryKeys.videos.all(ref.episodeId)
    const panelVideos = queryKeys.videos.panels(ref.episodeId)
    return {
      invalidate: [allVideos, panelVideos],
      refetchActive: [allVideos, panelVideos],
    }
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.EPISODE_DATA && ref.episodeId) {
    const queryKey = queryKeys.episodeData(ref.projectId, ref.episodeId)
    return { invalidate: [queryKey], refetchActive: [queryKey] }
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT && ref.episodeId) {
    const queryKey = queryKeys.project.context(ref.projectId, ref.episodeId)
    return { invalidate: [queryKey], refetchActive: [queryKey] }
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
    return {
      invalidate: projectAssetKeys,
      refetchActive: projectAssetKeys,
    }
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS) {
    const globalAssetKeys: QueryKey[] = [
      queryKeys.assets.all('global'),
      queryKeys.globalAssets.all(),
    ]
    return {
      invalidate: globalAssetKeys,
      refetchActive: globalAssetKeys,
    }
  }

  if (ref.kind === WORKSPACE_RESOURCE_KIND.PROJECT_DATA) {
    const queryKey = queryKeys.projectData(ref.projectId)
    return { invalidate: [queryKey], refetchActive: [queryKey] }
  }

  return { invalidate: [], refetchActive: [] }
}

function addQueryKeyOnce(target: Map<string, QueryKey>, queryKey: QueryKey): void {
  target.set(JSON.stringify(queryKey), queryKey)
}

export function extractWorkspaceResourceChangesFromWriteResult(params: {
  result: unknown
  projectId: string
  fallbackEpisodeId?: string | null
}): WorkspaceResourceChange[] {
  return extractWorkspaceResourceRefsFromWriteResult({
    result: params.result,
    fallbackProjectId: params.projectId,
    fallbackEpisodeId: params.fallbackEpisodeId,
  })
}

export async function syncWorkspaceResourceChanges(params: {
  queryClient: QueryClient
  changes: readonly WorkspaceResourceChange[]
}) {
  const changes = dedupeWorkspaceResourceRefs(params.changes)
  const invalidationKeys = new Map<string, QueryKey>()
  const activeRefetchKeys = new Map<string, QueryKey>()

  for (const change of changes) {
    const policy = policyForResource(change)
    for (const queryKey of policy.invalidate) addQueryKeyOnce(invalidationKeys, queryKey)
    for (const queryKey of policy.refetchActive) addQueryKeyOnce(activeRefetchKeys, queryKey)
  }

  await Promise.all([
    ...Array.from(invalidationKeys.values()).map((queryKey) => (
      params.queryClient.invalidateQueries({ queryKey })
    )),
    ...Array.from(activeRefetchKeys.values()).map((queryKey) => (
      params.queryClient.refetchQueries({ queryKey, type: 'active' })
    )),
  ])
}

export async function syncWorkspaceResourceChangesFromWriteResult(params: {
  queryClient: QueryClient
  result: unknown
  projectId: string
  fallbackEpisodeId?: string | null
}) {
  const changes = extractWorkspaceResourceChangesFromWriteResult({
    result: params.result,
    projectId: params.projectId,
    fallbackEpisodeId: params.fallbackEpisodeId,
  })
  if (changes.length === 0) return
  await syncWorkspaceResourceChanges({
    queryClient: params.queryClient,
    changes,
  })
}
