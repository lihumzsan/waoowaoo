'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'
import { queryKeys } from '@/lib/query/keys'

/** Full single-resource view (including content) via the single-resource read route. */
export function useWorkspaceResourceView(input: {
  readonly projectId: string
  readonly resourceId: string | null
  readonly enabled?: boolean
}) {
  return useQuery({
    queryKey: [
      ...queryKeys.project.workspaceResources(input.projectId),
      'resource',
      input.resourceId,
    ] as const,
    queryFn: async (): Promise<WorkspaceResourceView> => {
      const response = await apiFetch(`/api/projects/${input.projectId}/resources/${input.resourceId ?? ''}`)
      if (!response.ok) throw new Error('WORKSPACE_RESOURCE_LOAD_FAILED')
      const body = await response.json() as {
        readonly success: true
        readonly resource: WorkspaceResourceView
      }
      return body.resource
    },
    enabled: Boolean(input.projectId && input.resourceId) && (input.enabled ?? true),
    staleTime: 5_000,
  })
}
