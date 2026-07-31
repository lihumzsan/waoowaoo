'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentSessionSubagentView, AgentSessionView } from '@/lib/agent-turn/view-contract'
import { TASK_SSE_EVENT_TYPE, type TaskSSEEvent } from '@/lib/sse/events'
import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  isWorkspaceAssistantSessionSubagentTask,
  reduceWorkspaceAssistantSubagentLiveStream,
  removeWorkspaceAssistantSubagentLiveStreams,
  resolveWorkspaceAssistantSubagentTaskEventDisposition,
  type WorkspaceAssistantSubagentLiveStream,
} from './workspace-assistant-subagent-stream'
import {
  resolveWorkspaceAssistantSubagents,
  resolveWorkspaceAssistantSubagentStructuredOutputs,
} from './workspace-assistant-subagents'

const MAX_PENDING_OWNERSHIP_EVENTS = 256

interface PendingOwnershipEvents {
  events: TaskSSEEvent[]
  overflowed: boolean
}

function buildOwnershipViewRevision(params: {
  projectId: string
  episodeId: string | null
  view: AgentSessionView | null
}): string {
  const { projectId, episodeId, view } = params
  return JSON.stringify({
    projectId,
    episodeId,
    thread: view?.thread
      ? [view.thread.threadId, view.thread.modelHistoryVersion, view.thread.updatedAt]
      : null,
    currentTurn: view?.currentTurn
      ? [
          view.currentTurn.turnId,
          view.currentTurn.status,
          view.currentTurn.attempt,
          view.currentTurn.updatedAt,
        ]
      : null,
    subagents: [...(view?.subagents ?? [])]
      .map((subagent) => [
        subagent.taskId,
        subagent.status,
        subagent.finishedAt,
        subagent.events.at(-1)?.sequence ?? 0,
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  })
}

function isTerminalCreativeTaskEvent(event: TaskSSEEvent): boolean {
  if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return false
  const lifecycleType = event.payload?.lifecycleType
  return (
    lifecycleType === TASK_EVENT_TYPE.COMPLETED ||
    lifecycleType === TASK_EVENT_TYPE.FAILED ||
    lifecycleType === TASK_EVENT_TYPE.CANCELED
  )
}

export function useWorkspaceAssistantSubagentStream(params: {
  projectId: string
  episodeId: string | null
  view: AgentSessionView | null
  refetchView: () => Promise<AgentSessionView | null>
}): {
  subagents: readonly AgentSessionSubagentView[]
  structuredOutputs: ReadonlyMap<string, string>
} {
  const { subscribeTaskEvents } = useWorkspaceProvider()
  const { projectId, episodeId, view, refetchView } = params
  const scopeKey = `${projectId}:${episodeId ?? ''}`
  const viewRevision = buildOwnershipViewRevision({
    projectId,
    episodeId,
    view,
  })
  const scopeGenerationRef = useRef(0)
  const currentViewRevisionRef = useRef(viewRevision)
  currentViewRevisionRef.current = viewRevision
  const ownedTaskIdsRef = useRef<ReadonlySet<string>>(new Set())
  const requestedOwnershipRef = useRef<Set<string>>(new Set())
  const confirmedNonOwnedTaskRevisionsRef = useRef<Map<string, string>>(new Map())
  const pendingOwnershipEventsRef = useRef<Map<string, PendingOwnershipEvents>>(new Map())
  const invalidatedStreamIdentitiesRef = useRef<Set<string>>(new Set())
  const streamsRef = useRef<ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>>(new Map())
  const [streams, setStreams] = useState<ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>>(
    () => new Map(),
  )

  const replaceStreams = useCallback(
    (next: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>) => {
      if (next === streamsRef.current) return
      streamsRef.current = next
      setStreams(next)
    },
    [],
  )

  const clearTaskStreams = useCallback(
    (taskId: string) => {
      replaceStreams(removeWorkspaceAssistantSubagentLiveStreams(streamsRef.current, taskId))
      const prefix = `${taskId}|`
      for (const identity of invalidatedStreamIdentitiesRef.current) {
        if (identity.startsWith(prefix)) {
          invalidatedStreamIdentitiesRef.current.delete(identity)
        }
      }
    },
    [replaceStreams],
  )

  useEffect(() => {
    scopeGenerationRef.current += 1
    ownedTaskIdsRef.current = new Set()
    requestedOwnershipRef.current.clear()
    confirmedNonOwnedTaskRevisionsRef.current.clear()
    pendingOwnershipEventsRef.current.clear()
    invalidatedStreamIdentitiesRef.current.clear()
    streamsRef.current = new Map()
    setStreams(new Map())
  }, [scopeKey])

  useEffect(() => {
    currentViewRevisionRef.current = viewRevision
    for (const [taskId, confirmedRevision] of confirmedNonOwnedTaskRevisionsRef.current) {
      if (confirmedRevision !== viewRevision) {
        confirmedNonOwnedTaskRevisionsRef.current.delete(taskId)
      }
    }
    const ownedTaskIds = new Set((view?.subagents ?? []).map((subagent) => subagent.taskId))
    ownedTaskIdsRef.current = ownedTaskIds
    for (const taskId of ownedTaskIds) {
      confirmedNonOwnedTaskRevisionsRef.current.delete(taskId)
    }
    let next = streamsRef.current
    for (const stream of streamsRef.current.values()) {
      const subagent = view?.subagents.find((candidate) => candidate.taskId === stream.taskId)
      if (!subagent || subagent.status !== 'running') {
        next = removeWorkspaceAssistantSubagentLiveStreams(next, stream.taskId)
      }
    }
    replaceStreams(next)
  }, [replaceStreams, view, viewRevision])

  const refreshCanonicalView = useCallback(async (): Promise<AgentSessionView | null> => {
    const generation = scopeGenerationRef.current
    const refreshed = await refetchView()
    return generation === scopeGenerationRef.current ? refreshed : null
  }, [refetchView])

  const applyOwnedStreamEvent = useCallback(
    (event: TaskSSEEvent, refreshOnGap = true): boolean => {
      const reduction = reduceWorkspaceAssistantSubagentLiveStream(streamsRef.current, event, {
        ownedTaskIds: ownedTaskIdsRef.current,
        invalidatedStreamIdentities: invalidatedStreamIdentitiesRef.current,
      })
      if (reduction.kind === 'unchanged' || reduction.kind === 'unknown_task') return false
      if (reduction.kind === 'gap') {
        invalidatedStreamIdentitiesRef.current.add(reduction.streamIdentity)
        replaceStreams(reduction.streams)
        if (refreshOnGap) void refreshCanonicalView()
        return true
      }
      replaceStreams(reduction.streams)
      return false
    },
    [refreshCanonicalView, replaceStreams],
  )

  const reconcileTerminalTask = useCallback(
    (taskId: string) => {
      void refreshCanonicalView().then((refreshed) => {
        const subagent = refreshed?.subagents.find((candidate) => candidate.taskId === taskId)
        if (subagent && subagent.status !== 'running') {
          clearTaskStreams(taskId)
        }
      })
    },
    [clearTaskStreams, refreshCanonicalView],
  )

  const applyOwnedTaskEvent = useCallback(
    (event: TaskSSEEvent) => {
      if (event.type === TASK_SSE_EVENT_TYPE.STREAM) {
        applyOwnedStreamEvent(event)
        return
      }
      if (isTerminalCreativeTaskEvent(event)) {
        reconcileTerminalTask(event.taskId)
        return
      }
      void refreshCanonicalView()
    },
    [applyOwnedStreamEvent, reconcileTerminalTask, refreshCanonicalView],
  )

  const confirmUnknownTask = useCallback(
    (event: TaskSSEEvent) => {
      const pending = pendingOwnershipEventsRef.current.get(event.taskId)
      if (pending) {
        if (pending.events.length >= MAX_PENDING_OWNERSHIP_EVENTS) {
          pending.events = []
          pending.overflowed = true
        } else if (!pending.overflowed) {
          pending.events.push(event)
        }
        return
      }
      if (requestedOwnershipRef.current.has(event.taskId)) return

      requestedOwnershipRef.current.add(event.taskId)
      pendingOwnershipEventsRef.current.set(event.taskId, {
        events: [event],
        overflowed: false,
      })
      const requestGeneration = scopeGenerationRef.current
      void refreshCanonicalView()
        .then((refreshed) => {
          if (requestGeneration !== scopeGenerationRef.current) return
          const buffered = pendingOwnershipEventsRef.current.get(event.taskId)
          pendingOwnershipEventsRef.current.delete(event.taskId)
          requestedOwnershipRef.current.delete(event.taskId)
          if (!refreshed) {
            return
          }
          const refreshedRevision = buildOwnershipViewRevision({
            projectId,
            episodeId,
            view: refreshed,
          })
          currentViewRevisionRef.current = refreshedRevision
          if (!buffered) return
          const ownedTaskIds = new Set(refreshed.subagents.map((subagent) => subagent.taskId))
          ownedTaskIdsRef.current = ownedTaskIds
          if (!isWorkspaceAssistantSessionSubagentTask(ownedTaskIds, event.taskId)) {
            confirmedNonOwnedTaskRevisionsRef.current.set(event.taskId, refreshedRevision)
            return
          }
          confirmedNonOwnedTaskRevisionsRef.current.delete(event.taskId)
          let bufferedGap = false
          if (!buffered.overflowed) {
            for (const bufferedEvent of buffered.events) {
              if (bufferedEvent.type === TASK_SSE_EVENT_TYPE.STREAM) {
                bufferedGap = applyOwnedStreamEvent(bufferedEvent, false) || bufferedGap
              }
            }
          }
          if (buffered.events.some(isTerminalCreativeTaskEvent)) {
            reconcileTerminalTask(event.taskId)
          } else if (
            buffered.overflowed ||
            bufferedGap ||
            buffered.events.some(
              (bufferedEvent) => bufferedEvent.type === TASK_SSE_EVENT_TYPE.LIFECYCLE,
            )
          ) {
            void refreshCanonicalView()
          }
        })
        .catch(() => {
          if (requestGeneration !== scopeGenerationRef.current) return
          pendingOwnershipEventsRef.current.delete(event.taskId)
          requestedOwnershipRef.current.delete(event.taskId)
        })
    },
    [applyOwnedStreamEvent, episodeId, projectId, reconcileTerminalTask, refreshCanonicalView],
  )

  useEffect(
    () =>
      subscribeTaskEvents((event) => {
        if (
          (event.type !== TASK_SSE_EVENT_TYPE.STREAM &&
            event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) ||
          event.projectId !== projectId ||
          event.taskType !== TASK_TYPE.CREATIVE_WORK
        ) {
          return
        }
        const disposition = resolveWorkspaceAssistantSubagentTaskEventDisposition({
          ownedTaskIds: ownedTaskIdsRef.current,
          ownershipRequested: requestedOwnershipRef.current.has(event.taskId),
          ownershipConfirmedNonOwned:
            confirmedNonOwnedTaskRevisionsRef.current.get(event.taskId) ===
            currentViewRevisionRef.current,
          taskId: event.taskId,
        })
        if (disposition === 'accept') {
          applyOwnedTaskEvent(event)
        } else if (disposition === 'confirm') {
          confirmUnknownTask(event)
        }
      }),
    [applyOwnedTaskEvent, confirmUnknownTask, projectId, subscribeTaskEvents],
  )

  const subagents = useMemo(
    () =>
      resolveWorkspaceAssistantSubagents({
        sessionSubagents: view?.subagents ?? [],
        liveStreams: streams,
      }),
    [streams, view?.subagents],
  )
  const structuredOutputs = useMemo(
    () => resolveWorkspaceAssistantSubagentStructuredOutputs(streams),
    [streams],
  )
  return { subagents, structuredOutputs }
}
