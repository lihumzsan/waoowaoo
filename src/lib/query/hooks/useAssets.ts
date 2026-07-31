'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import {
  requestOperationMutationVoidWithError,
} from '@/lib/query/mutations/mutation-shared'
import { queryKeys } from '@/lib/query/keys'
import { syncWorkspaceResourceChanges } from '@/lib/query/resource-change-sync'
import {
  GLOBAL_ASSET_PROJECT_ID,
  resolveWorkspaceResourceRefs,
  WORKSPACE_RESOURCE_IMPACT,
} from '@/lib/workspace-resource/resource-impact'
import type {
  AssetKind,
  AssetQueryInput,
  ReadAssetsResponse,
} from '@/lib/assets/contracts'

function buildQueryPath(input: AssetQueryInput): string {
  const searchParams = new URLSearchParams({
    scope: input.scope,
  })
  if (input.projectId) {
    searchParams.set('projectId', input.projectId)
  }
  if (input.folderId) {
    searchParams.set('folderId', input.folderId)
  }
  if (input.kind) {
    searchParams.set('kind', input.kind)
  }
  return `/api/assets?${searchParams.toString()}`
}

export function useAssets(input: AssetQueryInput) {
  return useQuery({
    queryKey: queryKeys.assets.list(input),
    queryFn: async () => {
      const response = await apiFetch(buildQueryPath(input))
      if (!response.ok) {
        throw new Error('Failed to fetch assets')
      }
      const data = await response.json() as ReadAssetsResponse
      return data.assets
    },
    enabled: input.scope === 'global' || !!input.projectId,
    staleTime: 5_000,
  })
}

type AssetActionScopeInput = {
  scope: 'global' | 'project'
  projectId?: string | null
  kind: AssetKind
}

export function useRefreshAssets(input: { scope: 'global' | 'project'; projectId?: string | null }) {
  const queryClient = useQueryClient()
  return () => {
    return syncWorkspaceResourceChanges({
      queryClient,
      changes: resolveWorkspaceResourceRefs({
        impact: input.scope === 'global'
          ? WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS
          : WORKSPACE_RESOURCE_IMPACT.PROJECT_ASSETS,
        projectId: input.scope === 'global' ? GLOBAL_ASSET_PROJECT_ID : input.projectId ?? '',
        episodeId: null,
      }),
    })
  }
}

export function useAssetActions(input: AssetActionScopeInput) {
  const queryClient = useQueryClient()

  const create = async (payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    }, 'Failed to create asset', queryClient)
  }

  const remove = async (assetId: string) => {
    await requestOperationMutationVoidWithError(`/api/assets/${assetId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
      }),
    }, 'Failed to delete asset', queryClient)
  }

  const update = async (assetId: string, payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError(`/api/assets/${assetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    }, 'Failed to update asset', queryClient)
  }

  const uploadRender = async (assetId: string, file: File, imageIndex?: number) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('scope', input.scope)
    formData.append('kind', input.kind)
    if (input.projectId) formData.append('projectId', input.projectId)
    if (imageIndex !== undefined) formData.append('imageIndex', String(imageIndex))
    await requestOperationMutationVoidWithError(`/api/assets/${assetId}/upload-render`, {
      method: 'POST',
      body: formData,
    }, 'Failed to upload asset render', queryClient)
  }

  const selectRender = async (payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError(`/api/assets/${String(payload.id ?? payload.characterId ?? payload.locationId)}/select-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    }, 'Failed to select asset render', queryClient)
  }

  const revertRender = async (payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError(`/api/assets/${String(payload.id ?? payload.characterId ?? payload.locationId)}/revert-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    }, 'Failed to revert asset render', queryClient)
  }

  const copyFromGlobal = async (payload: { targetId: string; globalAssetId: string }) => {
    if (input.scope !== 'project' || !input.projectId) {
      throw new Error('copyFromGlobal is only available for project asset scope')
    }
    await requestOperationMutationVoidWithError(`/api/assets/${payload.targetId}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: input.kind,
        projectId: input.projectId,
        globalAssetId: payload.globalAssetId,
      }),
    }, 'Failed to copy asset from global library', queryClient)
  }

  const updateVariant = async (assetId: string, variantId: string, payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError(`/api/assets/${assetId}/variants/${variantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    }, 'Failed to update asset variant', queryClient)
  }

  return {
    create,
    update,
    updateVariant,
    uploadRender,
    remove,
    selectRender,
    revertRender,
    copyFromGlobal,
  }
}
