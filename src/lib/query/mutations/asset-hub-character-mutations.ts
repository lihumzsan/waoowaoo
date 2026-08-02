import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { queryKeys } from '../keys'
import type { GlobalCharacter } from '../hooks/useGlobalAssets'
import type { AssetSummary } from '@/lib/assets/contracts'
import {
  requestOperationMutationVoidWithError,
} from './mutation-shared'

interface SelectCharacterImageContext {
  previousQueries: Array<{
    queryKey: readonly unknown[]
    data: GlobalCharacter[] | undefined
  }>
  previousUnifiedQueries: Array<{
    queryKey: readonly unknown[]
    data: AssetSummary[] | undefined
  }>
  targetKey: string
  requestId: number
}

interface DeleteCharacterContext {
  previousQueries: Array<{
    queryKey: readonly unknown[]
    data: GlobalCharacter[] | undefined
  }>
  previousUnifiedQueries: Array<{
    queryKey: readonly unknown[]
    data: AssetSummary[] | undefined
  }>
}

function applyCharacterSelection(
  characters: GlobalCharacter[] | undefined,
  characterId: string,
  appearanceIndex: number,
  imageIndex: number | null,
): GlobalCharacter[] | undefined {
  if (!characters) return characters
  return characters.map((character) => {
    if (character.id !== characterId) return character
    return {
      ...character,
      appearances: (character.appearances || []).map((appearance) => {
        if (appearance.appearanceIndex !== appearanceIndex) return appearance
        const selectedUrl =
          imageIndex !== null && imageIndex >= 0
            ? (appearance.imageUrls[imageIndex] ?? null)
            : null
        return {
          ...appearance,
          selectedIndex: imageIndex,
          imageUrl: selectedUrl ?? appearance.imageUrl ?? null,
        }
      }),
    }
  })
}

function captureCharacterQuerySnapshots(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient
    .getQueriesData<GlobalCharacter[]>({
      queryKey: queryKeys.globalAssets.characters(),
      exact: false,
    })
    .map(([queryKey, data]) => ({ queryKey, data }))
}

function captureUnifiedQuerySnapshots(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient
    .getQueriesData<AssetSummary[]>({
      queryKey: queryKeys.assets.all(),
      exact: false,
    })
    .map(([queryKey, data]) => ({ queryKey, data }))
}

function applyUnifiedCharacterSelection(
  assets: AssetSummary[] | undefined,
  characterId: string,
  appearanceIndex: number,
  imageIndex: number | null,
): AssetSummary[] | undefined {
  if (!assets) return assets
  return assets.map((asset) => {
    if (asset.id !== characterId || asset.kind !== 'character') return asset
    return {
      ...asset,
      variants: asset.variants.map((variant) => {
        if (variant.index !== appearanceIndex) return variant
        return {
          ...variant,
          selectionState: {
            ...variant.selectionState,
            selectedRenderIndex: imageIndex,
          },
          renders: variant.renders.map((render) => ({
            ...render,
            isSelected: imageIndex !== null && render.index === imageIndex,
          })),
        }
      }),
    }
  })
}

function restoreCharacterQuerySnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: Array<{ queryKey: readonly unknown[]; data: GlobalCharacter[] | undefined }>,
) {
  snapshots.forEach((snapshot) => {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data)
  })
}

function restoreUnifiedQuerySnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: Array<{ queryKey: readonly unknown[]; data: AssetSummary[] | undefined }>,
) {
  snapshots.forEach((snapshot) => {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data)
  })
}

export function useSelectCharacterImage() {
  const queryClient = useQueryClient()
  const latestRequestIdByTargetRef = useRef<Record<string, number>>({})

  return useMutation({
    mutationFn: async ({
      characterId,
      appearanceIndex,
      imageIndex,
      confirm = false,
    }: {
      characterId: string
      appearanceIndex: number
      imageIndex: number | null
      confirm?: boolean
    }) => {
      await requestOperationMutationVoidWithError(`/api/assets/${characterId}/select-render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          kind: 'character',
          appearanceIndex,
          imageIndex,
          confirm,
        }),
      }, queryClient)
    },
    onMutate: async (variables): Promise<SelectCharacterImageContext> => {
      const targetKey = `${variables.characterId}:${variables.appearanceIndex}`
      const requestId = (latestRequestIdByTargetRef.current[targetKey] ?? 0) + 1
      latestRequestIdByTargetRef.current[targetKey] = requestId

      if (variables.confirm) {
        return { previousQueries: [], previousUnifiedQueries: [], targetKey, requestId }
      }

      await queryClient.cancelQueries({
        queryKey: queryKeys.globalAssets.characters(),
        exact: false,
      })
      await queryClient.cancelQueries({
        queryKey: queryKeys.assets.all(),
        exact: false,
      })
      const previousQueries = captureCharacterQuerySnapshots(queryClient)
      const previousUnifiedQueries = captureUnifiedQuerySnapshots(queryClient)

      queryClient.setQueriesData<GlobalCharacter[] | undefined>(
        {
          queryKey: queryKeys.globalAssets.characters(),
          exact: false,
        },
        (previous) => applyCharacterSelection(
          previous,
          variables.characterId,
          variables.appearanceIndex,
          variables.imageIndex,
        ),
      )

      queryClient.setQueriesData<AssetSummary[] | undefined>(
        {
          queryKey: queryKeys.assets.all(),
          exact: false,
        },
        (previous) => applyUnifiedCharacterSelection(
          previous,
          variables.characterId,
          variables.appearanceIndex,
          variables.imageIndex,
        ),
      )

      return {
        previousQueries,
        previousUnifiedQueries,
        targetKey,
        requestId,
      }
    },
    onError: (_error, _variables, context) => {
      if (!context) return
      const latestRequestId = latestRequestIdByTargetRef.current[context.targetKey]
      if (latestRequestId !== context.requestId) return
      restoreCharacterQuerySnapshots(queryClient, context.previousQueries)
      restoreUnifiedQuerySnapshots(queryClient, context.previousUnifiedQueries)
    },
  })
}

export function useUndoCharacterImage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ characterId, appearanceIndex }: { characterId: string; appearanceIndex: number }) => {
      await requestOperationMutationVoidWithError(`/api/assets/${characterId}/revert-render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          kind: 'character',
          appearanceIndex,
        }),
      }, queryClient)
    },
  })
}

export function useUploadCharacterImage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      file,
      characterId,
      appearanceIndex,
      labelText,
      imageIndex,
    }: {
      file: File
      characterId: string
      appearanceIndex: number
      labelText: string
      imageIndex?: number
    }) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', 'character')
      formData.append('id', characterId)
      formData.append('appearanceIndex', appearanceIndex.toString())
      formData.append('labelText', labelText)
      if (imageIndex !== undefined) {
        formData.append('imageIndex', imageIndex.toString())
      }

      await requestOperationMutationVoidWithError('/api/asset-hub/upload-image', {
        method: 'POST',
        body: formData,
      }, queryClient)
    },
  })
}

export function useDeleteCharacter() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (characterId: string) => {
      await requestOperationMutationVoidWithError(
        `/api/asset-hub/characters/${characterId}`,
        { method: 'DELETE' },
        queryClient,
      )
    },
    onMutate: async (characterId): Promise<DeleteCharacterContext> => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.globalAssets.characters(),
        exact: false,
      })
      await queryClient.cancelQueries({
        queryKey: queryKeys.assets.all(),
        exact: false,
      })
      const previousQueries = captureCharacterQuerySnapshots(queryClient)
      const previousUnifiedQueries = captureUnifiedQuerySnapshots(queryClient)

      queryClient.setQueriesData<GlobalCharacter[] | undefined>(
        {
          queryKey: queryKeys.globalAssets.characters(),
          exact: false,
        },
        (previous) => previous?.filter((character) => character.id !== characterId),
      )

      queryClient.setQueriesData<AssetSummary[] | undefined>(
        {
          queryKey: queryKeys.assets.all(),
          exact: false,
        },
        (previous) => previous?.filter((asset) => asset.id !== characterId),
      )

      return { previousQueries, previousUnifiedQueries }
    },
    onError: (_error, _characterId, context) => {
      if (!context) return
      restoreCharacterQuerySnapshots(queryClient, context.previousQueries)
      restoreUnifiedQuerySnapshots(queryClient, context.previousUnifiedQueries)
    },
  })
}

export function useDeleteCharacterAppearance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ characterId, appearanceIndex }: { characterId: string; appearanceIndex: number }) => {
      await requestOperationMutationVoidWithError(
        `/api/asset-hub/appearances?characterId=${characterId}&appearanceIndex=${appearanceIndex}`,
        { method: 'DELETE' },
        queryClient,
      )
    },
  })
}
