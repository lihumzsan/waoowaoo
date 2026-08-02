'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import {
  parseAssistantRuntimeSessionView,
  type AssistantRuntimeSessionView,
} from '@/lib/assistant-runtime/view-contract'
import { queryKeys } from '../keys'

export function useAgentSessionView(
  projectId: string | null,
) {
  return useQuery<AssistantRuntimeSessionView>({
    queryKey: queryKeys.project.assistantThread(projectId ?? ''),
    queryFn: async ({ signal }) => {
      if (!projectId) throw new Error('AGENT_SESSION_VIEW_PROJECT_ID_REQUIRED')
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/assistant/chat`,
        { signal },
      )
      if (!response.ok) {
        throw new Error(`AGENT_SESSION_VIEW_REQUEST_FAILED:${String(response.status)}`)
      }
      const view = await parseAssistantRuntimeSessionView(
        await response.json().catch(() => null),
      )
      if (
        view.scope.projectId !== projectId
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
