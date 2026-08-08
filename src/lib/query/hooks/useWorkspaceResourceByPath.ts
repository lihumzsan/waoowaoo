'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'
import { queryKeys } from '@/lib/query/keys'

/** Exact active-path lookup used by model-authored project links. */
export function useWorkspaceResourceByPath(input: {
  readonly projectId: string
  readonly workspacePath: string | null
  readonly enabled?: boolean
  readonly refreshToken?: string | null
}) {
  return useQuery({
    queryKey: [
      ...queryKeys.project.workspaceResources(input.projectId),
      'path',
      input.workspacePath,
      input.refreshToken ?? null,
    ] as const,
    queryFn: async (): Promise<WorkspaceResourceView> => {
      const params = new URLSearchParams({ path: input.workspacePath ?? '' })
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(input.projectId)}/resources/resolve?${params.toString()}`,
      )
      if (!response.ok) throw new Error('WORKSPACE_RESOURCE_PATH_LOAD_FAILED')
      const body = await response.json() as {
        readonly success: true
        readonly resource: WorkspaceResourceView
      }
      return body.resource
    },
    enabled: Boolean(input.projectId && input.workspacePath) && (input.enabled ?? true),
    staleTime: 2_000,
  })
}
