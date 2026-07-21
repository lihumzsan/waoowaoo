'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import type { ProjectAgentSessionState } from '@/lib/project-agent/session-state'
import {
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  TASK_TYPE,
  WORKSPACE_SSE_EVENT_TYPE,
  type AssistantSessionChangedSSEEvent,
} from '@/lib/task/types'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  isProjectAgentSessionEventWatermarkAtLeast,
  maxProjectAgentSessionEventWatermark,
  parseProjectAgentSessionEventWatermark,
} from '@/lib/project-agent/session-watermark'
import {
  reduceWorkspaceAssistantSubagentReasoningStream,
  removeWorkspaceAssistantSubagentReasoningStreams,
  type WorkspaceAssistantSubagentReasoningStream,
} from './workspace-assistant-subagent-stream'

interface WorkspaceAssistantSessionStateResponse {
  sessionState: ProjectAgentSessionState
  eventWatermark: string
}

interface UseWorkspaceAssistantSessionSyncInput {
  projectId: string
  episodeId?: string | null
  locale: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isWorkspaceAssistantSessionResponseFresh(params: {
  responseEventWatermark: string
  requiredEventWatermark: string
}): boolean {
  return isProjectAgentSessionEventWatermarkAtLeast({
    candidate: params.responseEventWatermark,
    required: params.requiredEventWatermark,
  })
}

async function fetchWorkspaceAssistantSessionState(params: {
  projectId: string
  episodeId?: string | null
  locale: string
}): Promise<WorkspaceAssistantSessionStateResponse> {
  const query = new URLSearchParams()
  if (params.episodeId) query.set('episodeId', params.episodeId)
  query.set('locale', params.locale)
  const response = await apiFetch(
    `/api/projects/${params.projectId}/assistant/session-state?${query.toString()}`,
  )
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(payload)) {
    throw new Error('PROJECT_AGENT_SESSION_STATE_FETCH_FAILED')
  }
  if (!isRecord(payload.sessionState)) throw new Error('PROJECT_AGENT_SESSION_STATE_INVALID')
  return {
    sessionState: payload.sessionState as unknown as ProjectAgentSessionState,
    eventWatermark: parseProjectAgentSessionEventWatermark(payload.eventWatermark),
  }
}

export function useWorkspaceAssistantSessionSync({
  projectId,
  episodeId,
  locale,
}: UseWorkspaceAssistantSessionSyncInput) {
  const { subscribeTaskEvents } = useWorkspaceProvider()
  const requestRef = useRef<{
    key: string
    minimumEventWatermark: string
    promise: Promise<ProjectAgentSessionState | null>
  } | null>(null)
  const latestEventWatermarkRef = useRef('0')
  const requestSequenceRef = useRef(0)
  const appliedRequestSequenceRef = useRef(0)
  const scopeGenerationRef = useRef(0)
  const [sessionState, setSessionState] = useState<ProjectAgentSessionState | null>(null)
  const [sessionStateError, setSessionStateError] = useState<string | null>(null)
  const [sessionEventWatermark, setSessionEventWatermark] = useState('0')
  const [subagentReasoningStreams, setSubagentReasoningStreams] = useState<
    ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream>
  >(() => new Map())

  const refreshSessionState = useCallback(async (
    minimumEventWatermark = latestEventWatermarkRef.current,
  ): Promise<ProjectAgentSessionState | null> => {
    const requestKey = `${projectId}:${episodeId ?? ''}:${locale}`
    const requiredEventWatermark = maxProjectAgentSessionEventWatermark(
      minimumEventWatermark,
      latestEventWatermarkRef.current,
    )
    if (
      requestRef.current?.key === requestKey
      && isWorkspaceAssistantSessionResponseFresh({
        responseEventWatermark: requestRef.current.minimumEventWatermark,
        requiredEventWatermark,
      })
    ) {
      return requestRef.current.promise
    }
    requestSequenceRef.current += 1
    const requestSequence = requestSequenceRef.current
    const scopeGeneration = scopeGenerationRef.current
    const promise = (async (): Promise<ProjectAgentSessionState | null> => {
      const response = await fetchWorkspaceAssistantSessionState({ projectId, episodeId, locale })
      if (scopeGeneration !== scopeGenerationRef.current) return null
      const currentRequiredWatermark = maxProjectAgentSessionEventWatermark(
        requiredEventWatermark,
        latestEventWatermarkRef.current,
      )
      if (!isWorkspaceAssistantSessionResponseFresh({
        responseEventWatermark: response.eventWatermark,
        requiredEventWatermark: currentRequiredWatermark,
      })) {
        throw new Error('PROJECT_AGENT_SESSION_STATE_STALE')
      }
      if (requestSequence < appliedRequestSequenceRef.current) return null
      appliedRequestSequenceRef.current = requestSequence
      latestEventWatermarkRef.current = maxProjectAgentSessionEventWatermark(
        latestEventWatermarkRef.current,
        response.eventWatermark,
      )
      setSessionEventWatermark(latestEventWatermarkRef.current)
      setSessionState(response.sessionState)
      setSessionStateError(null)
      return response.sessionState
    })()
      .catch((error: unknown) => {
        if (
          scopeGeneration === scopeGenerationRef.current
          && requestSequence >= appliedRequestSequenceRef.current
        ) {
          setSessionStateError(error instanceof Error ? error.message : String(error))
        }
        return null
      })
      .finally(() => {
        if (requestRef.current?.promise === promise) requestRef.current = null
      })
    requestRef.current = {
      key: requestKey,
      minimumEventWatermark: requiredEventWatermark,
      promise,
    }
    return promise
  }, [episodeId, locale, projectId])

  useEffect(() => {
    scopeGenerationRef.current += 1
    requestRef.current = null
    latestEventWatermarkRef.current = '0'
    requestSequenceRef.current = 0
    appliedRequestSequenceRef.current = 0
    setSessionState(null)
    setSessionStateError(null)
    setSessionEventWatermark('0')
    setSubagentReasoningStreams(new Map())
    void refreshSessionState()
    return () => {
      scopeGenerationRef.current += 1
    }
  }, [refreshSessionState])

  useEffect(() => subscribeTaskEvents((event) => {
    if (
      event.type === TASK_SSE_EVENT_TYPE.STREAM
      && event.projectId === projectId
      && event.taskType === TASK_TYPE.CREATIVE_WORK
      && (event.episodeId ?? undefined) === (episodeId ?? undefined)
    ) {
      setSubagentReasoningStreams((current) => {
        const reduction = reduceWorkspaceAssistantSubagentReasoningStream(current, event)
        if (reduction.kind === 'gap') void refreshSessionState()
        return reduction.streams
      })
      return
    }
    if (
      event.type === TASK_SSE_EVENT_TYPE.LIFECYCLE
      && event.projectId === projectId
      && event.taskType === TASK_TYPE.CREATIVE_WORK
      && (event.episodeId ?? undefined) === (episodeId ?? undefined)
    ) {
      const lifecycleType = isRecord(event.payload) && typeof event.payload.lifecycleType === 'string'
        ? event.payload.lifecycleType
        : null
      const terminal = lifecycleType === TASK_EVENT_TYPE.COMPLETED
        || lifecycleType === TASK_EVENT_TYPE.FAILED
        || lifecycleType === TASK_EVENT_TYPE.CANCELED
      void refreshSessionState().then((refreshed) => {
        if (!terminal || !refreshed) return
        setSubagentReasoningStreams((current) => (
          removeWorkspaceAssistantSubagentReasoningStreams(current, event.taskId)
        ))
      })
      return
    }
    if (event.type !== WORKSPACE_SSE_EVENT_TYPE.ASSISTANT_SESSION_CHANGED) return
    const assistantEvent: AssistantSessionChangedSSEEvent = event
    if (assistantEvent.assistantId !== 'workspace-command') return
    if ((assistantEvent.episodeId ?? undefined) !== (episodeId ?? undefined)) return
    latestEventWatermarkRef.current = maxProjectAgentSessionEventWatermark(
      latestEventWatermarkRef.current,
      assistantEvent.agentEventId,
    )
    setSessionEventWatermark(latestEventWatermarkRef.current)
    void refreshSessionState(assistantEvent.agentEventId)
  }), [episodeId, projectId, refreshSessionState, subscribeTaskEvents])

  return {
    sessionState,
    sessionStateError,
    sessionEventWatermark,
    subagentReasoningStreams,
    refreshSessionState,
  }
}
