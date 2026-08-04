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
    scope: 'global',
  })
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
    staleTime: 5_000,
  })
}

type AssetActionScopeInput = {
  kind: AssetKind
}

export function useRefreshAssets() {
  const queryClient = useQueryClient()
  return () => {
    return syncWorkspaceResourceChanges({
      queryClient,
      changes: resolveWorkspaceResourceRefs({
        impact: WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS,
        projectId: GLOBAL_ASSET_PROJECT_ID,
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
        scope: 'global',
        kind: input.kind,
        ...payload,
      }),
    }, queryClient)
  }

  const remove = async (assetId: string) => {
    await requestOperationMutationVoidWithError(`/api/assets/${assetId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        kind: input.kind,
      }),
    }, queryClient)
  }

  const update = async (assetId: string, payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError(`/api/assets/${assetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        kind: input.kind,
        ...payload,
      }),
    }, queryClient)
  }

  const selectRender = async (payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError(`/api/assets/${String(payload.id ?? payload.characterId ?? payload.locationId)}/select-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        kind: input.kind,
        ...payload,
      }),
    }, queryClient)
  }

  const revertRender = async (payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError(`/api/assets/${String(payload.id ?? payload.characterId ?? payload.locationId)}/revert-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        kind: input.kind,
        ...payload,
      }),
    }, queryClient)
  }

  const updateVariant = async (assetId: string, variantId: string, payload: Record<string, unknown>) => {
    await requestOperationMutationVoidWithError(`/api/assets/${assetId}/variants/${variantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        kind: input.kind,
        ...payload,
      }),
    }, queryClient)
  }

  return {
    create,
    update,
    updateVariant,
    remove,
    selectRender,
    revertRender,
  }
}
