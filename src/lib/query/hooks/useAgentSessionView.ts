'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import {
  parseAgentSessionView,
  type AgentSessionView,
} from '@/lib/agent-turn/view-contract'
import { queryKeys } from '../keys'

export function useAgentSessionView(
  projectId: string | null,
  episodeId?: string | null,
) {
  return useQuery<AgentSessionView>({
    queryKey: queryKeys.project.assistantThread(
      projectId ?? '',
      episodeId ?? '',
    ),
    queryFn: async ({ signal }) => {
      if (!projectId) throw new Error('AGENT_SESSION_VIEW_PROJECT_ID_REQUIRED')
      const search = new URLSearchParams()
      if (episodeId) search.set('episodeId', episodeId)
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/assistant/chat?${search.toString()}`,
        { signal },
      )
      if (!response.ok) {
        throw new Error(`AGENT_SESSION_VIEW_REQUEST_FAILED:${String(response.status)}`)
      }
      const view = await parseAgentSessionView(
        await response.json().catch(() => null),
      )
      if (
        view.scope.projectId !== projectId
        || view.scope.episodeId !== (episodeId ?? null)
        || view.scope.assistantId !== 'workspace-command'
      ) {
        throw new Error('AGENT_SESSION_VIEW_SCOPE_DIVERGED')
      }
      return view
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}
