import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  requestOperationMutationVoidWithError,
  requestJsonWithError,
} from './mutation-shared'

export function useUpdateCharacterName() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ characterId, name }: { characterId: string; name: string }) => {
      await requestOperationMutationVoidWithError(`/api/assets/${characterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          kind: 'character',
          name,
        }),
      }, queryClient)
    },
  })
}

export function useUpdateLocationName() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ locationId, name }: { locationId: string; name: string }) => {
      await requestOperationMutationVoidWithError(`/api/assets/${locationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          kind: 'location',
          name,
        }),
      }, queryClient)
    },
  })
}

export function useUpdateCharacterAppearanceDescription() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      characterId,
      appearanceIndex,
      description,
    }: {
      characterId: string
      appearanceIndex: number
      description: string
    }) => {
      const assetQuery = new URLSearchParams({
        scope: 'global',
        kind: 'character',
      })
      const assets = await requestJsonWithError<{ assets?: Array<{ id: string; variants?: Array<{ index: number; id: string }> }> }>(
        `/api/assets?${assetQuery.toString()}`,
        { method: 'GET' },
      )
      const asset = (assets.assets ?? []).find((item) => item.id === characterId)
      const variantId = asset?.variants?.find((variant) => variant.index === appearanceIndex)?.id
      if (!variantId) {
        throw new Error('Failed to resolve appearance variant')
      }
      await requestOperationMutationVoidWithError(`/api/assets/${characterId}/variants/${variantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          kind: 'character',
          description,
        }),
      }, queryClient)
    },
  })
}

export function useUpdateLocationSummary() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      locationId,
      summary,
    }: {
      locationId: string
      summary: string
    }) => {
      await requestOperationMutationVoidWithError(`/api/assets/${locationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          kind: 'location',
          summary,
        }),
      }, queryClient)
    },
  })
}
