'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import type { ProjectAssistantThreadSnapshot } from '@/lib/project-agent/types'
import { queryKeys } from '../keys'

interface ProjectAssistantThreadResponse {
  thread: ProjectAssistantThreadSnapshot | null
}

export function useProjectAssistantThread(projectId: string | null, episodeId?: string | null) {
  return useQuery({
    queryKey: queryKeys.project.assistantThread(projectId || '', episodeId || ''),
    queryFn: async () => {
      if (!projectId) throw new Error('projectId is required')
      const search = new URLSearchParams()
      if (episodeId) search.set('episodeId', episodeId)
      const response = await apiFetch(`/api/projects/${projectId}/assistant/chat?${search.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to load assistant thread')
      }
      const data = await response.json() as ProjectAssistantThreadResponse
      return data.thread
    },
    enabled: !!projectId,
    staleTime: 5000,
  })
}

export function useProjectAssistantThreadSync(
  projectId: string | null,
  episodeId?: string | null,
) {
  const queryClient = useQueryClient()

  const clear = useCallback(async (): Promise<void> => {
    if (!projectId) throw new Error('projectId is required')
    const search = new URLSearchParams()
    if (episodeId) search.set('episodeId', episodeId)
    const response = await apiFetch(`/api/projects/${projectId}/assistant/chat?${search.toString()}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error('Failed to clear assistant thread')
    }
    queryClient.setQueryData(queryKeys.project.assistantThread(projectId, episodeId || ''), null)
  }, [episodeId, projectId, queryClient])

  return {
    clear,
  }
}
