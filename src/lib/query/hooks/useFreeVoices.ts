'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '../keys'

export type FreeVoiceTaskState = {
  id: string
  status: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
} | null

export type FreeVoiceVersion = {
  id: string
  recordId: string
  versionNumber: number
  audioModel: string
  audioUrl: string | null
  audioMediaId: string | null
  audioDuration: number | null
  createdAt: string
  updatedAt: string
  task: FreeVoiceTaskState
}

export type FreeVoiceRecord = {
  id: string
  novelPromotionProjectId: string
  text: string
  characterId: string | null
  characterName: string
  voiceSourceType: 'character' | 'global_voice'
  voiceSourceId: string | null
  voiceName: string
  referenceAudioUrl: string
  referenceAudioMediaId: string | null
  createdAt: string
  updatedAt: string
  versions: FreeVoiceVersion[]
}

export function useFreeVoices(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.freeVoices.all(projectId || ''),
    enabled: !!projectId,
    queryFn: async () => {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/free-voices`)
      if (!response.ok) throw new Error('Failed to load free voices')
      return await response.json() as { records: FreeVoiceRecord[] }
    },
  })
}
