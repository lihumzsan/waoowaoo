'use client'
import { logError as _ulogError, logWarn as _ulogWarn } from '@/lib/logging/core'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TASK_SSE_EVENT_TYPE, WORKSPACE_SSE_EVENT_TYPE, type SSEEvent } from '@/lib/task/types'
import {
  applyWorkspaceSSEEvent,
} from '../workspace-sse-event-sync'
import { WorkspaceSSEEventSequence } from '../workspace-sse-event-sequence'
import {
  advanceWorkspaceSseCursor,
  EMPTY_WORKSPACE_SSE_CURSOR,
  isWorkspaceSseEvent,
  parseWorkspaceSseCursor,
  serializeWorkspaceSseCursor,
  type WorkspaceSseCursor,
} from '@/lib/sse/protocol'

type UseSSEOptions = {
  projectId?: string | null
  episodeId?: string | null
  enabled?: boolean
  onEvent?: (event: SSEEvent) => void
}

function cursorStorageKey(projectId: string, episodeId: string | null | undefined): string {
  return `workspace-sse-cursor:v4:${projectId}:${episodeId ?? 'all'}`
}

function readStoredCursor(projectId: string, episodeId: string | null | undefined): WorkspaceSseCursor {
  if (typeof window === 'undefined') return { ...EMPTY_WORKSPACE_SSE_CURSOR }
  const storage = window.sessionStorage
  if (!storage) return { ...EMPTY_WORKSPACE_SSE_CURSOR }
  try {
    return parseWorkspaceSseCursor(storage.getItem(cursorStorageKey(projectId, episodeId)))
  } catch (error) {
    _ulogError('[useSSE] invalid durable cursor', error)
    storage.removeItem(cursorStorageKey(projectId, episodeId))
    return { ...EMPTY_WORKSPACE_SSE_CURSOR }
  }
}

function persistCursor(projectId: string, episodeId: string | null | undefined, cursor: WorkspaceSseCursor): void {
  window.sessionStorage?.setItem(cursorStorageKey(projectId, episodeId), serializeWorkspaceSseCursor(cursor))
}

export function useSSE({ projectId, episodeId, enabled = true, onEvent }: UseSSEOptions) {
  const queryClient = useQueryClient()
  const sourceRef = useRef<EventSource | null>(null)
  const cursorRef = useRef<WorkspaceSseCursor>({ ...EMPTY_WORKSPACE_SSE_CURSOR })
  const [snapshotResyncGeneration, setSnapshotResyncGeneration] = useState(0)

  const connection = useMemo(() => {
    if (!projectId) return null
    const cursor = readStoredCursor(projectId, episodeId)
    const params = new URLSearchParams({ projectId })
    if (episodeId) params.set('episodeId', episodeId)
    if (
      cursor.taskEventId > 0
      || cursor.agentEventId !== '0'
      || cursor.resourceEventAtMs > 0
    ) {
      params.set('cursor', serializeWorkspaceSseCursor(cursor))
    }
    return { url: `/api/sse?${params}`, cursor, generation: snapshotResyncGeneration }
  }, [projectId, episodeId, snapshotResyncGeneration])
  const eventSequence = useMemo(
    () => new WorkspaceSSEEventSequence(
      connection?.cursor.taskEventId ?? 0,
      {},
      connection?.cursor.agentEventId ?? '0',
    ),
    [connection],
  )

  const applyEvent = useCallback((payload: SSEEvent) => {
    if (!projectId) return
    applyWorkspaceSSEEvent({
      queryClient,
      event: payload,
      projectId,
    })
    onEvent?.(payload)
  }, [onEvent, projectId, queryClient])

  const handleParsedEvent = useCallback((payload: unknown, transportCursor?: string) => {
    if (!isWorkspaceSseEvent(payload)) throw new Error('WORKSPACE_SSE_EVENT_INVALID')
    const decision = eventSequence.process(payload, applyEvent)
    if (decision === 'duplicate' || decision === 'invalid') return
    const nextCursor = transportCursor
      ? parseWorkspaceSseCursor(transportCursor)
      : advanceWorkspaceSseCursor(cursorRef.current, payload)
    cursorRef.current = nextCursor
    if (projectId) {
      persistCursor(projectId, episodeId, nextCursor)
    }
  }, [applyEvent, episodeId, eventSequence, projectId])

  const requestSnapshotResync = useCallback(() => {
    if (!projectId) return
    window.sessionStorage?.removeItem(cursorStorageKey(projectId, episodeId))
    cursorRef.current = { ...EMPTY_WORKSPACE_SSE_CURSOR }
    sourceRef.current?.close()
    sourceRef.current = null
    setSnapshotResyncGeneration((current) => current + 1)
  }, [episodeId, projectId])

  useEffect(() => {
    if (!enabled || !connection || !projectId) return

    cursorRef.current = readStoredCursor(projectId, episodeId)
    const source = new EventSource(connection.url)
    sourceRef.current = source

    const handleEvent = (event: MessageEvent) => {
      try {
        handleParsedEvent(JSON.parse(event.data || '{}'), event.lastEventId || undefined)
      } catch (error) {
        _ulogError('[useSSE] failed to parse event', error)
        requestSnapshotResync()
      }
    }

    source.onmessage = handleEvent
    const namedEvents = [
      TASK_SSE_EVENT_TYPE.LIFECYCLE,
      TASK_SSE_EVENT_TYPE.STREAM,
      WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
      WORKSPACE_SSE_EVENT_TYPE.ASSISTANT_SESSION_CHANGED,
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
      for (const listener of listeners) {
        source.removeEventListener(listener.type, listener.handler)
      }
      source.close()
      sourceRef.current = null
    }
  }, [connection, enabled, projectId, episodeId, handleParsedEvent, requestSnapshotResync])

  return {
    connected: !!sourceRef.current && sourceRef.current.readyState === EventSource.OPEN,
  }
}
