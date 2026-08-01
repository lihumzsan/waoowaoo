'use client'
import { logError as _ulogError, logWarn as _ulogWarn } from '@/lib/logging/core'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  TASK_SSE_EVENT_TYPE,
  WORKSPACE_SSE_EVENT_TYPE,
  type SSEEvent,
} from '@/lib/sse/events'
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
import { useToast } from '@/contexts/ToastContext'
import { useTranslations } from 'next-intl'

type UseSSEOptions = {
  projectId?: string | null
  episodeId?: string | null
  enabled?: boolean
  onEvent?: (event: SSEEvent) => void
}

function cursorStorageKey(projectId: string, episodeId: string | null | undefined): string {
  return `workspace-sse-cursor:v5:${projectId}:${episodeId ?? 'all'}`
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
  const tErrors = useTranslations('errors')
  const { dismissToast, showToast } = useToast()
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectToastRef = useRef<string | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const stabilityTimerRef = useRef<number | null>(null)
  const cursorRef = useRef<WorkspaceSseCursor>({ ...EMPTY_WORKSPACE_SSE_CURSOR })
  const [snapshotResyncGeneration, setSnapshotResyncGeneration] = useState(0)
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')

  const connection = useMemo(() => {
    if (!projectId) return null
    const cursor = readStoredCursor(projectId, episodeId)
    const params = new URLSearchParams({ projectId })
    if (episodeId) params.set('episodeId', episodeId)
    if (cursor.taskEventId > 0) {
      params.set('cursor', serializeWorkspaceSseCursor(cursor))
    }
    return { url: `/api/sse?${params}`, cursor, generation: snapshotResyncGeneration }
  }, [projectId, episodeId, snapshotResyncGeneration])
  const eventSequence = useMemo(
    () => new WorkspaceSSEEventSequence(connection?.cursor.taskEventId ?? 0),
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

    setConnectionState('connecting')
    cursorRef.current = readStoredCursor(projectId, episodeId)
    const source = new EventSource(connection.url)
    sourceRef.current = source

    const scheduleResync = (context: string) => {
      setConnectionState('reconnecting')
      if (!reconnectToastRef.current) {
        reconnectToastRef.current = showToast(tErrors('sseDisconnected'), 'warning', 0)
      }
      const attempt = reconnectAttemptRef.current + 1
      reconnectAttemptRef.current = attempt
      const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5))
      _ulogWarn(`[useSSE] ${context}; scheduling resync`, { projectId, episodeId, attempt, delayMs })
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        requestSnapshotResync()
      }, delayMs)
    }

    const handleEvent = (event: MessageEvent) => {
      try {
        handleParsedEvent(JSON.parse(event.data || '{}'), event.lastEventId || undefined)
      } catch (error) {
        _ulogError('[useSSE] failed to parse event', error)
        // 立即重连会撞上 bootstrap 重发的同一条毒事件,形成自激循环;必须退避。
        scheduleResync('event handling failed')
      }
    }

    source.onmessage = handleEvent
    const namedEvents = [
      TASK_SSE_EVENT_TYPE.LIFECYCLE,
      TASK_SSE_EVENT_TYPE.STREAM,
      WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
      WORKSPACE_SSE_EVENT_TYPE.AGENT_SESSION_VIEW_CHANGED,
      WORKSPACE_SSE_EVENT_TYPE.AGENT_TURN_STREAM,
    ] as const
    const listeners: Array<{ type: string; handler: EventListener }> = []
    for (const type of namedEvents) {
      const handler: EventListener = (event) => handleEvent(event as MessageEvent)
      source.addEventListener(type, handler)
      listeners.push({ type, handler })
    }
    source.onopen = () => {
      setConnectionState('connected')
      if (reconnectToastRef.current) {
        dismissToast(reconnectToastRef.current)
        reconnectToastRef.current = null
        showToast(tErrors('sseRestored'), 'success', 3000)
      }
      // 不能在每个事件/每次 open 时立刻清零:毒事件循环里每一轮都会短暂"健康",
      // 立刻清零会把退避锁死在 1s。只有连接稳定存活 60s 才认为恢复。
      if (stabilityTimerRef.current !== null) window.clearTimeout(stabilityTimerRef.current)
      stabilityTimerRef.current = window.setTimeout(() => {
        stabilityTimerRef.current = null
        reconnectAttemptRef.current = 0
      }, 60_000)
    }
    source.onerror = () => {
      // EventSource 只对网络类中断自动重连;服务端返回非 2xx(部署重启的 502、
      // bootstrap 5xx、401)时按规范进入 CLOSED 且永不重试——必须显式重建,
      // 否则页面在下一次刷新前永久失联("必须刷新才显示"的传输层根因)。
      if (source.readyState !== EventSource.CLOSED) return
      scheduleResync('stream closed')
    }

    return () => {
      for (const listener of listeners) {
        source.removeEventListener(listener.type, listener.handler)
      }
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (stabilityTimerRef.current !== null) {
        window.clearTimeout(stabilityTimerRef.current)
        stabilityTimerRef.current = null
      }
      source.close()
      sourceRef.current = null
    }
  }, [connection, dismissToast, enabled, episodeId, handleParsedEvent, projectId, requestSnapshotResync, showToast, tErrors])

  useEffect(() => () => {
    if (reconnectToastRef.current) {
      dismissToast(reconnectToastRef.current)
      reconnectToastRef.current = null
    }
  }, [dismissToast])

  return {
    connected: connectionState === 'connected',
    connectionState,
  }
}
