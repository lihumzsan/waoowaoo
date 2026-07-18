'use client'

import { useRunStreamState, type RunResult } from './useRunStreamState'
import { TASK_TYPE } from '@/lib/task/types'
import { apiFetch } from '@/lib/api-fetch'
import { selectRecoverableRun } from '@/lib/run-runtime/recovery'
import { parseRecoverableRuns } from './run-stream/recovery-response'

export type ScriptToStoryboardRunParams = {
  episodeId: string
  model?: string
  temperature?: number
  reasoning?: boolean
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
}

export type ScriptToStoryboardRunResult = RunResult

type UseScriptToStoryboardRunStreamOptions = {
  projectId: string
  episodeId?: string | null
  enableRecoveryProbe?: boolean
}

export function useScriptToStoryboardRunStream({
  projectId,
  episodeId,
  enableRecoveryProbe = true,
}: UseScriptToStoryboardRunStreamOptions) {
  return useRunStreamState<ScriptToStoryboardRunParams>({
    projectId,
    endpoint: (pid) => `/api/novel-promotion/${pid}/script-to-storyboard-stream`,
    storageKeyPrefix: 'novel-promotion:script-to-storyboard-run',
    storageScopeKey: episodeId || undefined,
    enableRecoveryProbe,
    resolveActiveRunId: async ({ projectId: pid, storageScopeKey }) => {
      if (!storageScopeKey) return null
      const search = new URLSearchParams({
        projectId: pid,
        workflowType: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
        targetType: 'NovelPromotionEpisode',
        targetId: storageScopeKey,
        episodeId: storageScopeKey,
        limit: '20',
      })
      search.append('status', 'queued')
      search.append('status', 'running')
      search.append('status', 'canceling')
      search.set('_v', '2')
      const response = await apiFetch(`/api/runs?${search.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error('Failed to load active script-to-storyboard runs')
      }
      const runs = parseRecoverableRuns(await response.json())
      const decision = selectRecoverableRun(runs)
      if (runs.length > 0 && !decision.runId) {
        throw new Error('Invalid active script-to-storyboard runs response')
      }
      return decision.runId
    },
    validateParams: (params) => {
      if (!params.episodeId) {
        throw new Error('episodeId is required')
      }
    },
    buildRequestBody: (params) => ({
      episodeId: params.episodeId,
      model: params.model || undefined,
      temperature: params.temperature,
      reasoning: params.reasoning,
      reasoningEffort: params.reasoningEffort,
      async: true,
      displayMode: 'detail',
    }),
  })
}
