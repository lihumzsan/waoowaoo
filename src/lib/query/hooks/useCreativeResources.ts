'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import type { CreativeResourceCardView } from '@/lib/creative-resource/contracts'
import { queryKeys } from '@/lib/query/keys'

interface CreativeResourcesResponse {
  readonly success: true
  readonly resources: readonly CreativeResourceCardView[]
}

export function useCreativeResources(
  projectId: string,
  episodeId: string | null,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.project.creativeResources(projectId, episodeId),
    ] as const,
    queryFn: async (): Promise<CreativeResourcesResponse> => {
      const search = new URLSearchParams()
      search.set('episodeId', episodeId ?? '')
      search.set('includeProjectScope', 'true')
      const response = await apiFetch(`/api/projects/${projectId}/resources?${search.toString()}`)
      if (!response.ok) throw new Error('CREATIVE_RESOURCES_LOAD_FAILED')
      return await response.json() as CreativeResourcesResponse
    },
    enabled: Boolean(projectId),
    staleTime: 5_000,
  })
}
