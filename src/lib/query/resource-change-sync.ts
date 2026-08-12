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

function readWorkspaceResourceQueryRevision(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const pages = (value as Record<string, unknown>).pages
  if (!Array.isArray(pages) || pages.length === 0) return null
  let revision: number | null = null
  for (const page of pages) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) return null
    const pageRevision = (page as Record<string, unknown>).revision
    if (typeof pageRevision !== 'number' || !Number.isSafeInteger(pageRevision) || pageRevision < 0) return null
    revision = revision === null
      ? pageRevision
      : Math.min(revision, pageRevision)
  }
  return revision
}

export function readActiveWorkspaceResourceRevision(params: {
  queryClient: QueryClient
  projectId: string
}): number | null {
  const queries = params.queryClient.getQueriesData<unknown>({
    queryKey: queryKeys.project.workspaceResourcesAll(params.projectId),
    type: 'active',
  })
  if (queries.length === 0) return null
  let revision: number | null = null
  for (const [, data] of queries) {
    const queryRevision = readWorkspaceResourceQueryRevision(data)
    if (queryRevision === null) return null
    revision = revision === null ? queryRevision : Math.min(revision, queryRevision)
  }
  return revision
}

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
    return [
      queryKeys.project.workspaceResourcesAll(ref.projectId),
      queryKeys.projectData(ref.projectId),
    ]
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

export async function syncWorkspaceResourceRevision(params: {
  queryClient: QueryClient
  projectId: string
  serverRevision: number
}): Promise<boolean> {
  if (!Number.isSafeInteger(params.serverRevision) || params.serverRevision < 0) {
    throw new Error('WORKSPACE_RESOURCE_REVISION_INVALID')
  }
  const activeRevision = readActiveWorkspaceResourceRevision(params)
  if (activeRevision !== null && activeRevision >= params.serverRevision) return false
  await syncWorkspaceResourceChanges({
    queryClient: params.queryClient,
    changes: [{ kind: 'workspaceResources', projectId: params.projectId }],
  })
  return true
}
