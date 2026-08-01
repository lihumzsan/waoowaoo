import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  requestOperationMutationVoidWithError,
  requestJsonWithError,
} from './mutation-shared'

export function useUpdateProjectCharacterIntroduction(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
        mutationFn: async ({
            characterId,
            introduction,
        }: {
            characterId: string
            introduction: string
        }) => {
            await requestOperationMutationVoidWithError(`/api/projects/${projectId}/character`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId, introduction }),
            }, queryClient)
        },
  })
}

/**
 * 上传临时媒体（项目）
 */

export function useUploadProjectTempMedia() {
    return useMutation({
        mutationFn: async (payload: { imageBase64?: string; base64?: string; extension?: string; type?: string }) => {
            return await requestJsonWithError<{ success: boolean; url?: string; key?: string }>(
                '/api/asset-hub/upload-temp',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
            )
        },
    })
}

/**
 * 创建项目角色
 */

export function useCreateProjectCharacter(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
        mutationFn: async (payload: {
            name: string
            description: string
        }) =>
            await requestOperationMutationVoidWithError(
                `/api/projects/${projectId}/character`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                queryClient,
            ),
  })
}

/**
 * 为项目角色添加子形象
 */

export function useCreateProjectCharacterAppearance(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
        mutationFn: async (payload: {
            characterId: string
            changeReason: string
            description: string
        }) =>
            await requestOperationMutationVoidWithError(
                `/api/projects/${projectId}/character/appearance`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                queryClient,
            ),
  })
}

export function useConfirmProjectCharacterSelection(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
        mutationFn: async ({ characterId, appearanceId }: { characterId: string; appearanceId: string }) =>
            await requestOperationMutationVoidWithError(
                `/api/projects/${projectId}/character/confirm-selection`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ characterId, appearanceId }),
                },
                queryClient,
            ),
  })
}
