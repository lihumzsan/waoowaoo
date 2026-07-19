'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, isTaskTerminalEventType, type SSEEvent } from '@/lib/task/types'
import {
  appendStructuredJsonChunk,
  createStructuredStreamObjectParseState,
  createStructuredStreamParseState,
  type StructuredStreamParseState,
} from '@/lib/structured-stream/incremental-json'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  findStructuredStreamAdapters,
  type StructuredStreamAdapter,
  type StructuredStreamItem,
} from '@/lib/structured-stream/workspace-structured-stream-adapters'
import type {
  WorkspaceCanvasStreamPatch,
  WorkspaceCanvasStreamTarget,
  WorkspaceStructuredStreamHandoffIdentity,
} from './workspace-structured-stream-runtime-types'
import {
  markTaskEntriesForTerminalHandoff,
  removeExactTerminalHandoffs,
  removeTargetTerminalHandoffs,
  removeTaskEntries,
} from './workspace-structured-stream-handoff'
import {
  addBoundedIdentity,
  createStructuredStreamAccumulatorKey,
  trimOldestMapEntries,
} from './workspace-structured-stream-identity'
import { normalizeStructuredStreamItems } from './workspace-structured-stream-items'
import {
  buildStreamRuntimeEntries,
  type StructuredStreamSnapshot,
  type WorkspaceStructuredStreamTranslate,
} from './workspace-structured-stream-projection'

interface UseWorkspaceStructuredStreamRuntimeInput {
  readonly episodeId: string
  readonly translate: WorkspaceStructuredStreamTranslate
}

interface UseWorkspaceStructuredStreamRuntimeResult {
  readonly targets: readonly WorkspaceCanvasStreamTarget[]
  readonly patches: readonly WorkspaceCanvasStreamPatch[]
  readonly releaseTerminalHandoffs: (identities: readonly WorkspaceStructuredStreamHandoffIdentity[]) => void
}

export interface StreamAccumulator {
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string | null
  readonly episodeId: string | null
  readonly stepId: string | null
  readonly stepAttempt: number
  readonly streamRunId: string
  readonly lane: string
  readonly adapter: StructuredStreamAdapter
  readonly parseState: StructuredStreamParseState
  readonly items: readonly StructuredStreamItem[]
  readonly errorMessage: string | null
  readonly lastSeq: number
  readonly terminalHandoff: boolean
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

const MAX_STREAM_ACCUMULATORS = 128

export function processStructuredStreamEvent(
  current: ReadonlyMap<string, StreamAccumulator>,
  event: SSEEvent,
): ReadonlyMap<string, StreamAccumulator> {
  if (event.type !== TASK_SSE_EVENT_TYPE.STREAM) return current
  const payload = readRecord(event.payload)
  const stream = readRecord(payload.stream)
  const delta = readString(stream.delta)
  const kind = readString(stream.kind)
  if (!delta || kind !== 'text') return current

  const stepId = readString(payload.stepId)
  const stepAttempt = readPositiveInteger(payload.stepAttempt)
  const streamRunId = readString(payload.streamRunId)
  const lane = readString(stream.lane) ?? 'main'
  const seq = readPositiveInteger(stream.seq)
  if (!streamRunId || !stepAttempt || !seq) return current
  const checkpoint = readRecord(payload.streamCheckpoint)
  const isRecoveryCheckpoint = readPositiveInteger(checkpoint.fromSeq) === 1
    && readPositiveInteger(checkpoint.throughSeq) === seq
  const adapters = findStructuredStreamAdapters({
    taskType: event.taskType ?? null,
    stepId,
  })
  if (adapters.length === 0) return current

  const next = new Map(removeTargetTerminalHandoffs(
    current,
    event.targetType ?? null,
    event.targetId ?? null,
  ))
  adapters.forEach((adapter) => {
    const key = createStructuredStreamAccumulatorKey({
      taskId: event.taskId,
      streamRunId,
      stepAttempt,
      stepId,
      lane,
      adapterKey: adapter.key,
    })
    const previous = next.get(key)
    const logicalAccumulators = [...next.entries()].filter(([, accumulator]) => (
      accumulator.taskId === event.taskId
      && accumulator.stepId === stepId
      && accumulator.lane === lane
      && accumulator.adapter.key === adapter.key
    ))
    const highestAttempt = logicalAccumulators.reduce(
      (highest, [, accumulator]) => Math.max(highest, accumulator.stepAttempt),
      0,
    )
    if (stepAttempt < highestAttempt) return
    if (stepAttempt > highestAttempt) {
      logicalAccumulators.forEach(([accumulatorKey]) => next.delete(accumulatorKey))
    }
    if (
      stepAttempt === highestAttempt
      && !previous
      && (seq === 1 || isRecoveryCheckpoint)
    ) {
      logicalAccumulators.forEach(([accumulatorKey]) => next.delete(accumulatorKey))
    }
    if (previous && seq <= previous.lastSeq) return
    if (previous && !isRecoveryCheckpoint && seq !== previous.lastSeq + 1) return
    if (!previous && !isRecoveryCheckpoint && seq !== 1) return
    const replacesFromCheckpoint = isRecoveryCheckpoint
    const parseState = !replacesFromCheckpoint && previous?.parseState ? previous.parseState : (
      adapter.mode === 'object'
        ? createStructuredStreamObjectParseState(adapter.path)
        : createStructuredStreamParseState(adapter.path)
    )
    try {
      const result = appendStructuredJsonChunk(parseState, delta)
      const normalized = normalizeStructuredStreamItems(
        adapter,
        replacesFromCheckpoint ? [] : previous?.items ?? [],
        result.items,
      )
      next.set(key, {
        taskId: event.taskId,
        taskType: event.taskType ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        episodeId: event.episodeId ?? null,
        stepId,
        stepAttempt,
        streamRunId,
        lane,
        adapter,
        parseState: result.state,
        items: normalized.items,
        errorMessage: normalized.errorMessage
          ?? (replacesFromCheckpoint ? null : previous?.errorMessage ?? null),
        lastSeq: seq,
        terminalHandoff: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      next.set(key, {
        taskId: event.taskId,
        taskType: event.taskType ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        episodeId: event.episodeId ?? null,
        stepId,
        stepAttempt,
        streamRunId,
        lane,
        adapter,
        parseState,
        items: replacesFromCheckpoint ? [] : previous?.items ?? [],
        errorMessage: message,
        lastSeq: seq,
        terminalHandoff: false,
      })
    }
  })

  trimOldestMapEntries(next, MAX_STREAM_ACCUMULATORS)

  return next
}

export function snapshotsFromAccumulators(
  accumulators: ReadonlyMap<string, StreamAccumulator>,
): readonly StructuredStreamSnapshot[] {
  return [...accumulators.values()]
    .filter((accumulator) => accumulator.items.length > 0)
    .map((accumulator) => ({
      taskId: accumulator.taskId,
      taskType: accumulator.taskType,
      targetType: accumulator.targetType,
      targetId: accumulator.targetId,
      episodeId: accumulator.episodeId,
      adapterKey: accumulator.adapter.key,
      items: accumulator.items,
      errorMessage: accumulator.errorMessage,
      terminalHandoff: accumulator.terminalHandoff,
    }))
}

export function shouldClearStreamAccumulatorsForLifecycle(
  lifecycleType: string | null,
  payload: Record<string, unknown>,
): boolean {
  return lifecycleType === TASK_EVENT_TYPE.CREATED && readString(payload.reason) === 'watchdog_requeue'
}

export function isTerminalStructuredStreamLifecycle(lifecycleType: string | null): boolean {
  return isTaskTerminalEventType(lifecycleType)
}

export function useWorkspaceStructuredStreamRuntime({
  episodeId,
  translate,
}: UseWorkspaceStructuredStreamRuntimeInput): UseWorkspaceStructuredStreamRuntimeResult {
  const { subscribeTaskEvents } = useWorkspaceProvider()
  const [accumulators, setAccumulators] = useState<ReadonlyMap<string, StreamAccumulator>>(() => new Map())
  const terminalStreamRunIdsRef = useRef<ReadonlySet<string>>(new Set())
  const streamRunIdsByTaskRef = useRef<ReadonlyMap<string, readonly string[]>>(new Map())

  useEffect(() => {
    return subscribeTaskEvents((event) => {
      if ('episodeId' in event && event.episodeId && event.episodeId !== episodeId) return
      if (event.type === TASK_SSE_EVENT_TYPE.STREAM) {
        const payload = readRecord(event.payload)
        const streamRunId = readString(payload.streamRunId)
        if (!streamRunId || terminalStreamRunIdsRef.current.has(streamRunId)) return
        const runsByTask = new Map(streamRunIdsByTaskRef.current)
        const taskRuns = [...(runsByTask.get(event.taskId) ?? [])].filter((value) => value !== streamRunId)
        taskRuns.push(streamRunId)
        runsByTask.set(event.taskId, taskRuns.slice(-8))
        trimOldestMapEntries(runsByTask, 128)
        streamRunIdsByTaskRef.current = runsByTask
        setAccumulators((current) => processStructuredStreamEvent(current, event))
        return
      }
      if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return
      const payload = readRecord(event.payload)
      const lifecycleType = readString(payload.lifecycleType)
      if (shouldClearStreamAccumulatorsForLifecycle(lifecycleType, payload)) {
        setAccumulators((current) => removeTaskEntries(current, event.taskId))
        return
      }
      if (!isTerminalStructuredStreamLifecycle(lifecycleType)) return
      for (const streamRunId of streamRunIdsByTaskRef.current.get(event.taskId) ?? []) {
        terminalStreamRunIdsRef.current = addBoundedIdentity(
          terminalStreamRunIdsRef.current,
          streamRunId,
        )
      }
      const runsByTask = new Map(streamRunIdsByTaskRef.current)
      runsByTask.delete(event.taskId)
      streamRunIdsByTaskRef.current = runsByTask
      setAccumulators((current) => (
        lifecycleType === TASK_EVENT_TYPE.COMPLETED
          ? markTaskEntriesForTerminalHandoff(current, event.taskId)
          : removeTaskEntries(current, event.taskId)
      ))
    })
  }, [episodeId, subscribeTaskEvents])

  const releaseTerminalHandoffs = useCallback((identities: readonly WorkspaceStructuredStreamHandoffIdentity[]) => {
    setAccumulators((current) => removeExactTerminalHandoffs(current, identities))
  }, [])

  const entries = useMemo(
    () => buildStreamRuntimeEntries(
      snapshotsFromAccumulators(accumulators),
      episodeId,
      translate,
    ),
    [accumulators, episodeId, translate],
  )

  return useMemo(() => ({
    targets: entries.map((entry) => entry.target),
    patches: entries.map((entry) => entry.patch),
    releaseTerminalHandoffs,
  }), [entries, releaseTerminalHandoffs])
}
