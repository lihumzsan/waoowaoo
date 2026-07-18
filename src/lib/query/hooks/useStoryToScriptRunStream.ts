'use client'

import { useRunStreamState, type RunResult } from './useRunStreamState'
import { TASK_TYPE } from '@/lib/task/types'
import { apiFetch } from '@/lib/api-fetch'
import { selectRecoverableRun } from '@/lib/run-runtime/recovery'
import { parseRecoverableRuns } from './run-stream/recovery-response'

export type StoryToScriptRunParams = {
  episodeId: string
  content: string
  model?: string
  temperature?: number
  reasoning?: boolean
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
}

export type StoryToScriptRunResult = RunResult

type UseStoryToScriptRunStreamOptions = {
  projectId: string
  episodeId?: string | null
  enableRecoveryProbe?: boolean
}

export function useStoryToScriptRunStream({
  projectId,
  episodeId,
  enableRecoveryProbe = true,
}: UseStoryToScriptRunStreamOptions) {
  return useRunStreamState<StoryToScriptRunParams>({
    projectId,
    endpoint: (pid) => `/api/novel-promotion/${pid}/story-to-script-stream`,
    storageKeyPrefix: 'novel-promotion:story-to-script-run',
    storageScopeKey: episodeId || undefined,
    enableRecoveryProbe,
    resolveActiveRunId: async ({ projectId: pid, storageScopeKey }) => {
      if (!storageScopeKey) return null
      const search = new URLSearchParams({
        projectId: pid,
        workflowType: TASK_TYPE.STORY_TO_SCRIPT_RUN,
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
        throw new Error('Failed to load active story-to-script runs')
      }
      const runs = parseRecoverableRuns(await response.json())
      const decision = selectRecoverableRun(runs)
      if (runs.length > 0 && !decision.runId) {
        throw new Error('Invalid active story-to-script runs response')
      }
      return decision.runId
    },
    validateParams: (params) => {
      if (!params.episodeId) {
        throw new Error('episodeId is required')
      }
      if (!params.content.trim()) {
        throw new Error('content is required')
      }
    },
    buildRequestBody: (params) => ({
      episodeId: params.episodeId,
      content: params.content,
      model: params.model || undefined,
      temperature: params.temperature,
      reasoning: params.reasoning,
      reasoningEffort: params.reasoningEffort,
      async: true,
      displayMode: 'detail',
    }),
  })
}
