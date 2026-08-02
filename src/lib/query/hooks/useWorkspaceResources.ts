'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import type { WorkspaceResourceTreePage } from '@/lib/workspace-resource/contracts'
import { queryKeys } from '@/lib/query/keys'

export function useWorkspaceResources(input: {
  readonly projectId: string
  readonly prefix: string | null
  readonly search: string | null
  readonly enabled?: boolean
}) {
  return useInfiniteQuery({
    queryKey: [
      ...queryKeys.project.workspaceResources(input.projectId),
      input.prefix,
      input.search,
    ] as const,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<WorkspaceResourceTreePage> => {
      const search = new URLSearchParams({ limit: '200' })
      if (input.prefix) search.set('prefix', input.prefix)
      if (input.search) search.set('search', input.search)
      if (pageParam) search.set('cursor', pageParam)
      const response = await apiFetch(`/api/projects/${input.projectId}/resources?${search.toString()}`)
      if (!response.ok) throw new Error('WORKSPACE_RESOURCES_LOAD_FAILED')
      const body = await response.json() as {
        readonly success: true
        readonly page: WorkspaceResourceTreePage
      }
      return body.page
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(input.projectId) && (input.enabled ?? true),
    staleTime: 2_000,
  })
}
