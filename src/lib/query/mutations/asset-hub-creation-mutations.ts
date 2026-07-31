import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  requestOperationMutationVoidWithError,
  requestJsonWithError,
} from './mutation-shared'

type CreateAssetHubCharacterVariables = {
  name: string
  description: string
  folderId?: string | null
}

export function useCreateAssetHubLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      name: string
      summary: string
      folderId: string | null
      count?: number
    }) => {
      await requestOperationMutationVoidWithError('/api/asset-hub/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, '创建失败', queryClient)
    },
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

  return useMutation({
    mutationFn: async (payload: CreateAssetHubCharacterVariables) =>
      await requestOperationMutationVoidWithError('/api/asset-hub/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, '创建角色失败', queryClient),
  })
}
