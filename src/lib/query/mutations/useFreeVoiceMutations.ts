'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { requestJsonWithError } from './mutation-shared'
import type { FreeVoiceRecord, FreeVoiceVersion } from '../hooks/useFreeVoices'

function useFreeVoiceInvalidation(projectId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.freeVoices.all(projectId) })
}

export function useCreateFreeVoice(projectId: string) {
  const invalidate = useFreeVoiceInvalidation(projectId)
  return useMutation({
    mutationFn: async (payload: {
      text: string
      characterId: string
      voiceSourceType: 'character' | 'global_voice'
      voiceSourceId: string
    }) => requestJsonWithError<{ record: FreeVoiceRecord; version: FreeVoiceVersion; taskId: string }>(
      `/api/novel-promotion/${projectId}/free-voices`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      '创建自由配音失败',
    ),
    onSuccess: invalidate,
  })
}

export function useGenerateFreeVoiceVersion(projectId: string) {
  const invalidate = useFreeVoiceInvalidation(projectId)
  return useMutation({
    mutationFn: async ({ recordId }: { recordId: string }) =>
      requestJsonWithError<{ version: FreeVoiceVersion; taskId: string }>(
        `/api/novel-promotion/${projectId}/free-voices/${recordId}/versions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        '生成新版本失败',
      ),
    onSuccess: invalidate,
  })
}

export function useKeepFreeVoiceVersion(projectId: string) {
  const invalidate = useFreeVoiceInvalidation(projectId)
  return useMutation({
    mutationFn: async ({ recordId, versionId }: { recordId: string; versionId: string }) =>
      requestJsonWithError<{ record: FreeVoiceRecord }>(
        `/api/novel-promotion/${projectId}/free-voices/${recordId}/keep-version`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId }),
        },
        '保留版本失败',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteFreeVoiceRecord(projectId: string) {
  const invalidate = useFreeVoiceInvalidation(projectId)
  return useMutation({
    mutationFn: async ({ recordId }: { recordId: string }) =>
      requestJsonWithError<{ success: boolean; deleted: boolean }>(
        `/api/novel-promotion/${projectId}/free-voices/${recordId}`,
        { method: 'DELETE' },
        '删除自由配音失败',
      ),
    onSuccess: invalidate,
  })
}
