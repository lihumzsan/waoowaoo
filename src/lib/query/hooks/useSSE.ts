'use client'
import { logError as _ulogError, logWarn as _ulogWarn } from '@/lib/logging/core'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TASK_SSE_EVENT_TYPE, WORKSPACE_SSE_EVENT_TYPE, type SSEEvent } from '@/lib/task/types'
import { apiFetch } from '@/lib/api-fetch'
import {
  applyWorkspaceSSEEvent,
} from '../workspace-sse-event-sync'
import { WorkspaceSSEEventSequence } from '../workspace-sse-event-sequence'
import { queryKeys } from '../keys'

const SSE_REPLAY_POLL_MS = 5000

type UseSSEOptions = {
  projectId?: string | null
  episodeId?: string | null
  enabled?: boolean
  onEvent?: (event: SSEEvent) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function useSSE({ projectId, episodeId, enabled = true, onEvent }: UseSSEOptions) {
  const queryClient = useQueryClient()
  const sourceRef = useRef<EventSource | null>(null)
  const targetStatesInvalidateTimerRef = useRef<number | null>(null)
  const replayInFlightRef = useRef(false)
  const isGlobalAssetProject = projectId === 'global-asset-hub'
  const eventSequence = useMemo(
    () => new WorkspaceSSEEventSequence(),
    [episodeId, projectId],
  )

  const url = useMemo(() => {
    if (!projectId) return null
    const params = new URLSearchParams({ projectId })
    if (episodeId) params.set('episodeId', episodeId)
    return `/api/sse?${params}`
  }, [projectId, episodeId])

  const scheduleTargetStatesInvalidation = useCallback(() => {
    if (!projectId || targetStatesInvalidateTimerRef.current !== null) return
    targetStatesInvalidateTimerRef.current = window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.targetStatesAll(projectId), exact: false })
      targetStatesInvalidateTimerRef.current = null
    }, 800)
  }, [projectId, queryClient])

  const applyEvent = useCallback((payload: SSEEvent) => {
    if (!projectId) return
    applyWorkspaceSSEEvent({
      queryClient,
      event: payload,
      projectId,
      episodeId,
      isGlobalAssetProject,
      scheduleTargetStatesInvalidation,
    })
    onEvent?.(payload)
  }, [episodeId, isGlobalAssetProject, onEvent, projectId, queryClient, scheduleTargetStatesInvalidation])

  const handleParsedEvent = useCallback((payload: unknown) => {
    eventSequence.process(payload, applyEvent)
  }, [applyEvent, eventSequence])

  useEffect(() => {
    if (!enabled || !url || !projectId) return

    const source = new EventSource(url)
    sourceRef.current = source

    const handleEvent = (event: MessageEvent) => {
      try {
        handleParsedEvent(JSON.parse(event.data || '{}'))
      } catch (error) {
        _ulogError('[useSSE] failed to parse event', error)
      }
    }

    source.onmessage = handleEvent
    const namedEvents = [
      TASK_SSE_EVENT_TYPE.LIFECYCLE,
      TASK_SSE_EVENT_TYPE.STREAM,
      WORKSPACE_SSE_EVENT_TYPE.MUTATION_BATCH,
      WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
    ] as const
    const listeners: Array<{ type: string; handler: EventListener }> = []
    for (const type of namedEvents) {
      const handler: EventListener = (event) => handleEvent(event as MessageEvent)
      source.addEventListener(type, handler)
      listeners.push({ type, handler })
    }
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return
      _ulogWarn('[useSSE] stream closed', { projectId, episodeId })
    }

    return () => {
      if (targetStatesInvalidateTimerRef.current !== null) {
        window.clearTimeout(targetStatesInvalidateTimerRef.current)
        targetStatesInvalidateTimerRef.current = null
      }
      for (const listener of listeners) {
        source.removeEventListener(listener.type, listener.handler)
      }
      source.close()
      sourceRef.current = null
    }
  }, [enabled, url, projectId, episodeId, handleParsedEvent])

  useEffect(() => {
    if (!enabled || !projectId) return
    let cancelled = false

    const replayMissedEvents = async () => {
      if (replayInFlightRef.current) return
      replayInFlightRef.current = true
      try {
        const params = new URLSearchParams({
          projectId,
          lastEventId: String(eventSequence.getLastNumericEventId()),
        })
        if (episodeId) params.set('episodeId', episodeId)
        const response = await apiFetch(`/api/sse/replay?${params.toString()}`)
        if (!response.ok) {
          _ulogWarn('[useSSE] replay request failed', { projectId, episodeId, status: response.status })
          return
        }
        const payload = await response.json().catch(() => null) as unknown
        if (!isRecord(payload) || !Array.isArray(payload.events)) return
        for (const event of payload.events) {
          if (cancelled) return
          handleParsedEvent(event)
        }
      } catch (error) {
        _ulogWarn('[useSSE] replay failed', {
          projectId,
          episodeId,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        replayInFlightRef.current = false
      }
    }

    const timer = window.setInterval(() => {
      void replayMissedEvents()
    }, SSE_REPLAY_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled, episodeId, eventSequence, handleParsedEvent, projectId])

  return {
    connected: !!sourceRef.current && sourceRef.current.readyState === EventSource.OPEN,
  }
}
