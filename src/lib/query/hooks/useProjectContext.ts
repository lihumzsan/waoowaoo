'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import type { ProjectContextSnapshot } from '@/lib/project-context/types'
import { queryKeys } from '../keys'

interface ProjectContextResponse {
  readonly context: ProjectContextSnapshot
}

export function useProjectContext(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: queryKeys.project.context(projectId || '', episodeId || ''),
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required')
      const search = new URLSearchParams()
      if (episodeId) search.set('episodeId', episodeId)
      const query = search.toString()
      const path = query
        ? `/api/projects/${projectId}/context?${query}`
        : `/api/projects/${projectId}/context`
      const response = await apiFetch(path)
      if (!response.ok) {
        throw new Error('Failed to load project context')
      }
      const payload = await response.json() as ProjectContextResponse
      return payload.context
    },
    enabled: Boolean(projectId),
    staleTime: 5000,
  })
}
