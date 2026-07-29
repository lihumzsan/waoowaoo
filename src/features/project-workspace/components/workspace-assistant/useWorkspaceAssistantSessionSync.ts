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
  type TaskSSEEvent,
} from '@/lib/task/types'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  isProjectAgentSessionEventWatermarkAtLeast,
  maxProjectAgentSessionEventWatermark,
  parseProjectAgentSessionEventWatermark,
} from '@/lib/project-agent/session-watermark'
import {
  isWorkspaceAssistantSessionSubagentTask,
  reduceWorkspaceAssistantSubagentLiveStream,
  removeWorkspaceAssistantSubagentLiveStreams,
  resolveWorkspaceAssistantSubagentTaskEventDisposition,
  type WorkspaceAssistantSubagentLiveStream,
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

interface WorkspaceAssistantSessionRefreshOptions {
  minimumEventWatermark?: string
  forceNewRequest?: boolean
}

const MAX_PENDING_SUBAGENT_OWNERSHIP_EVENTS = 256

interface PendingSubagentOwnershipEvents {
  events: TaskSSEEvent[]
  overflowed: boolean
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

function hasTerminalWorkspaceAssistantSubagent(
  sessionState: ProjectAgentSessionState,
  taskId: string,
): boolean {
  return sessionState.subagents.some((subagent) => (
    subagent.taskId === taskId && subagent.status !== 'running'
  ))
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
  const ownedSubagentTaskIdsRef = useRef<ReadonlySet<string>>(new Set())
  const requestedSubagentOwnershipRef = useRef<Set<string>>(new Set())
  const pendingSubagentOwnershipEventsRef = useRef<
    Map<string, PendingSubagentOwnershipEvents>
  >(new Map())
  const invalidatedSubagentStreamIdentitiesRef = useRef<Set<string>>(new Set())
  const subagentLiveStreamsRef = useRef<
    ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>
  >(new Map())
  const [sessionState, setSessionState] = useState<ProjectAgentSessionState | null>(null)
  const [sessionStateError, setSessionStateError] = useState<string | null>(null)
  const [sessionEventWatermark, setSessionEventWatermark] = useState('0')
  const [subagentLiveStreams, setSubagentLiveStreams] = useState<
    ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>
  >(() => new Map())

  const refreshSessionState = useCallback(async (
    options: WorkspaceAssistantSessionRefreshOptions = {},
  ): Promise<ProjectAgentSessionState | null> => {
    const requestKey = `${projectId}:${episodeId ?? ''}:${locale}`
    const requiredEventWatermark = maxProjectAgentSessionEventWatermark(
      options.minimumEventWatermark ?? latestEventWatermarkRef.current,
      latestEventWatermarkRef.current,
    )
    if (
      !options.forceNewRequest
      && requestRef.current?.key === requestKey
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
      ownedSubagentTaskIdsRef.current = new Set(
        response.sessionState.subagents.map((subagent) => subagent.taskId),
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
    ownedSubagentTaskIdsRef.current = new Set()
    requestedSubagentOwnershipRef.current.clear()
    pendingSubagentOwnershipEventsRef.current.clear()
    invalidatedSubagentStreamIdentitiesRef.current.clear()
    subagentLiveStreamsRef.current = new Map()
    setSessionState(null)
    setSessionStateError(null)
    setSessionEventWatermark('0')
    setSubagentLiveStreams(new Map())
    void refreshSessionState()
    return () => {
      scopeGenerationRef.current += 1
    }
  }, [refreshSessionState])

  const replaceSubagentLiveStreams = useCallback((
    streams: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>,
  ): void => {
    if (streams === subagentLiveStreamsRef.current) return
    subagentLiveStreamsRef.current = streams
    setSubagentLiveStreams(streams)
  }, [])

  const clearSubagentLiveTask = useCallback((taskId: string): void => {
    replaceSubagentLiveStreams(
      removeWorkspaceAssistantSubagentLiveStreams(
        subagentLiveStreamsRef.current,
        taskId,
      ),
    )
    const prefix = `${taskId}|`
    for (const identity of invalidatedSubagentStreamIdentitiesRef.current) {
      if (identity.startsWith(prefix)) {
        invalidatedSubagentStreamIdentitiesRef.current.delete(identity)
      }
    }
  }, [replaceSubagentLiveStreams])

  const applyOwnedSubagentStreamEvent = useCallback((
    event: TaskSSEEvent,
    refreshOnGap = true,
  ): void => {
    const reduction = reduceWorkspaceAssistantSubagentLiveStream(
      subagentLiveStreamsRef.current,
      event,
      {
        ownedTaskIds: ownedSubagentTaskIdsRef.current,
        invalidatedStreamIdentities: invalidatedSubagentStreamIdentitiesRef.current,
      },
    )
    if (reduction.kind === 'unknown_task' || reduction.kind === 'unchanged') return
    if (reduction.kind === 'gap') {
      invalidatedSubagentStreamIdentitiesRef.current.add(reduction.streamIdentity)
      replaceSubagentLiveStreams(reduction.streams)
      if (refreshOnGap) void refreshSessionState()
      return
    }
    replaceSubagentLiveStreams(reduction.streams)
  }, [refreshSessionState, replaceSubagentLiveStreams])

  const isTerminalCreativeTaskEvent = useCallback((event: TaskSSEEvent): boolean => {
    if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return false
    const lifecycleType = isRecord(event.payload) && typeof event.payload.lifecycleType === 'string'
      ? event.payload.lifecycleType
      : null
    return lifecycleType === TASK_EVENT_TYPE.COMPLETED
      || lifecycleType === TASK_EVENT_TYPE.FAILED
      || lifecycleType === TASK_EVENT_TYPE.CANCELED
  }, [])

  const reconcileTerminalSubagent = useCallback((taskId: string): void => {
    void refreshSessionState({ forceNewRequest: true }).then((refreshed) => {
      if (
        refreshed
        && hasTerminalWorkspaceAssistantSubagent(refreshed, taskId)
      ) {
        clearSubagentLiveTask(taskId)
      }
    })
  }, [clearSubagentLiveTask, refreshSessionState])

  const applyOwnedSubagentTaskEvent = useCallback((event: TaskSSEEvent): void => {
    if (event.type === TASK_SSE_EVENT_TYPE.STREAM) {
      applyOwnedSubagentStreamEvent(event)
      return
    }
    const terminal = isTerminalCreativeTaskEvent(event)
    if (terminal) {
      reconcileTerminalSubagent(event.taskId)
      return
    }
    void refreshSessionState()
  }, [
    applyOwnedSubagentStreamEvent,
    isTerminalCreativeTaskEvent,
    reconcileTerminalSubagent,
    refreshSessionState,
  ])

  const confirmUnknownSubagentTaskEvent = useCallback((event: TaskSSEEvent): void => {
    const pending = pendingSubagentOwnershipEventsRef.current.get(event.taskId)
    if (pending) {
      if (pending.events.length >= MAX_PENDING_SUBAGENT_OWNERSHIP_EVENTS) {
        pending.events = []
        pending.overflowed = true
      } else if (!pending.overflowed) {
        pending.events.push(event)
      }
      return
    }
    if (requestedSubagentOwnershipRef.current.has(event.taskId)) return

    requestedSubagentOwnershipRef.current.add(event.taskId)
    pendingSubagentOwnershipEventsRef.current.set(event.taskId, {
      events: [event],
      overflowed: false,
    })
    void refreshSessionState().then((refreshed) => {
      const buffered = pendingSubagentOwnershipEventsRef.current.get(event.taskId)
      pendingSubagentOwnershipEventsRef.current.delete(event.taskId)
      if (
        !refreshed
        || !buffered
        || !isWorkspaceAssistantSessionSubagentTask(
          ownedSubagentTaskIdsRef.current,
          event.taskId,
        )
      ) return

      if (!buffered.overflowed) {
        for (const bufferedEvent of buffered.events) {
          if (bufferedEvent.type === TASK_SSE_EVENT_TYPE.STREAM) {
            applyOwnedSubagentStreamEvent(bufferedEvent, false)
          }
        }
      }
      if (buffered.events.some(isTerminalCreativeTaskEvent)) {
        reconcileTerminalSubagent(event.taskId)
      }
    })
  }, [
    applyOwnedSubagentStreamEvent,
    isTerminalCreativeTaskEvent,
    reconcileTerminalSubagent,
    refreshSessionState,
  ])

  useEffect(() => subscribeTaskEvents((event) => {
    if (
      (
        event.type === TASK_SSE_EVENT_TYPE.STREAM
        || event.type === TASK_SSE_EVENT_TYPE.LIFECYCLE
      )
      && event.projectId === projectId
      && event.taskType === TASK_TYPE.CREATIVE_WORK
    ) {
      const disposition = resolveWorkspaceAssistantSubagentTaskEventDisposition({
        ownedTaskIds: ownedSubagentTaskIdsRef.current,
        ownershipRequestedTaskIds: requestedSubagentOwnershipRef.current,
        taskId: event.taskId,
      })
      if (disposition === 'accept') {
        applyOwnedSubagentTaskEvent(event)
      } else if (disposition === 'confirm') {
        confirmUnknownSubagentTaskEvent(event)
      }
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
    void refreshSessionState({ minimumEventWatermark: assistantEvent.agentEventId })
  }), [
    applyOwnedSubagentTaskEvent,
    confirmUnknownSubagentTaskEvent,
    episodeId,
    projectId,
    refreshSessionState,
    subscribeTaskEvents,
  ])

  return {
    sessionState,
    sessionStateError,
    sessionEventWatermark,
    subagentLiveStreams,
    refreshSessionState,
  }
}
