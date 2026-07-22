import { useMutation, useQueryClient } from '@tanstack/react-query'
import { mapGlobalCharacterToAsset } from '@/lib/assets/mappers'
import type { AssetSummary } from '@/lib/assets/contracts'
import type { GlobalCharacter } from '@/lib/query/hooks/useGlobalAssets'
import { queryKeys } from '@/lib/query/keys'
import {
  requestJsonWithError,
} from './mutation-shared'
import {
  invalidateGlobalCharacters,
  invalidateGlobalLocations,
} from './asset-hub-mutations-shared'

type CreateAssetHubCharacterResponse = {
  character?: GlobalCharacter
}

type CreateAssetHubCharacterVariables = {
  name: string
  description: string
  folderId?: string | null
}

function queryFolderFilter(queryKey: readonly unknown[], index: number): string | null {
  const value = queryKey[index]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function upsertCharacter<T extends { id: string; folderId?: string | null }>(
  items: T[] | undefined,
  character: T,
  folderFilter: string | null,
) {
  if (!items) return items
  if (folderFilter && character.folderId !== folderFilter) return items
  const existingIndex = items.findIndex((item) => item.id === character.id)
  if (existingIndex >= 0) {
    return items.map((item, index) => index === existingIndex ? character : item)
  }
  return [character, ...items]
}

function upsertCreatedCharacterCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  character: GlobalCharacter,
) {
  queryClient
    .getQueriesData<GlobalCharacter[]>({
      queryKey: queryKeys.globalAssets.characters(),
      exact: false,
    })
    .forEach(([queryKey, data]) => {
      const folderFilter = queryFolderFilter(queryKey, 2)
      queryClient.setQueryData(queryKey, upsertCharacter(data, character, folderFilter))
    })

  const unifiedCharacter = mapGlobalCharacterToAsset(character)
  queryClient
    .getQueriesData<AssetSummary[]>({
      queryKey: queryKeys.assets.all('global'),
      exact: false,
    })
    .forEach(([queryKey, data]) => {
      const folderFilter = queryFolderFilter(queryKey, 2)
      const kindFilter = queryFolderFilter(queryKey, 3)
      if (kindFilter && kindFilter !== 'character') return
      queryClient.setQueryData(queryKey, upsertCharacter(data, unifiedCharacter, folderFilter))
    })
}

export function useCreateAssetHubLocation() {
  const queryClient = useQueryClient()
  const invalidateLocations = () => invalidateGlobalLocations(queryClient)

  return useMutation({
    mutationFn: async (payload: {
      name: string
      summary: string
      folderId: string | null
      count?: number
    }) => {
      return await requestJsonWithError('/api/asset-hub/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, '创建失败')
    },
    onSuccess: invalidateLocations,
  })
}

export function useUploadAssetHubTempMedia() {
  return useMutation({
    mutationFn: async (payload: { imageBase64?: string; base64?: string; extension?: string; type?: string }) =>
      await requestJsonWithError<{ success: boolean; url?: string; key?: string }>(
        '/api/asset-hub/upload-temp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '上传失败',
      ),
  })
}

export function useCreateAssetHubCharacter() {
  const queryClient = useQueryClient()
  const invalidateCharacters = () => invalidateGlobalCharacters(queryClient)

  return useMutation({
    mutationFn: async (payload: CreateAssetHubCharacterVariables) =>
      await requestJsonWithError<CreateAssetHubCharacterResponse>('/api/asset-hub/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, '创建角色失败'),
    onSuccess: (data: CreateAssetHubCharacterResponse) => {
      if (data.character) {
        upsertCreatedCharacterCaches(queryClient, data.character)
      }
      invalidateCharacters()
    },
  })
}
