'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  calculateEstimatedTaskProgress,
  type EstimatedTaskProgressSnapshot,
} from '@/lib/task/estimated-progress'

export interface EstimatedTaskProgressSource {
  readonly targetType?: string | null
  readonly targetId?: string | null
  readonly phase?: string | null
  readonly runningTaskId?: string | null
  readonly runningTaskType?: string | null
  readonly updatedAt?: string | null
  readonly lastError?: {
    readonly code?: string | null
    readonly message?: string | null
  } | null
}

const TASK_PROGRESS_START_STORAGE_PREFIX = 'waoowaoo:task-progress-start:'
const PROGRESS_TICK_MS = 1000

function parseIsoMillis(value: string | null | undefined): number | null {
  if (!value) return null
  const millis = Date.parse(value)
  return Number.isFinite(millis) ? millis : null
}

function sanitizeStartMillis(value: number, now: number): number {
  if (!Number.isFinite(value) || value <= 0) return now
  return Math.min(value, now)
}

function taskProgressKey(source: EstimatedTaskProgressSource | null | undefined): string | null {
  if (!source) return null
  const taskType = source.runningTaskType?.trim()
  if (!taskType) return null
  const taskId = source.runningTaskId?.trim()
  if (taskId) return `task:${taskId}`
  const targetType = source.targetType?.trim()
  const targetId = source.targetId?.trim()
  if (targetType && targetId) return `target:${targetType}:${targetId}:${taskType}`
  return `type:${taskType}`
}

function readStoredStartMillis(key: string): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(`${TASK_PROGRESS_START_STORAGE_PREFIX}${key}`)
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function writeStoredStartMillis(key: string, value: number) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(`${TASK_PROGRESS_START_STORAGE_PREFIX}${key}`, String(Math.floor(value)))
}

function resolveInitialStartMillis(source: EstimatedTaskProgressSource, key: string, now: number): number {
  const stored = readStoredStartMillis(key)
  if (stored !== null) return sanitizeStartMillis(stored, now)
  const updatedAtMillis = parseIsoMillis(source.updatedAt)
  const startMillis = sanitizeStartMillis(updatedAtMillis ?? now, now)
  writeStoredStartMillis(key, startMillis)
  return startMillis
}

export function useEstimatedTaskProgress(
  source: EstimatedTaskProgressSource | null | undefined,
): EstimatedTaskProgressSnapshot | null {
  const [now, setNow] = useState(() => Date.now())
  const [startState, setStartState] = useState<{
    readonly key: string
    readonly millis: number
  } | null>(null)

  const key = taskProgressKey(source)
  const active = source?.phase === 'queued' || source?.phase === 'processing'

  useEffect(() => {
    if (!source || !key || !active) {
      setStartState(null)
      return
    }
    setStartState((current) => {
      if (current?.key === key) return current
      const currentNow = Date.now()
      return {
        key,
        millis: resolveInitialStartMillis(source, key, currentNow),
      }
    })
  }, [active, key, source])

  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, PROGRESS_TICK_MS)
    return () => window.clearInterval(timer)
  }, [active])

  return useMemo(() => {
    if (!source) return null
    const startMillis = startState?.key === key
      ? startState.millis
      : now
    return calculateEstimatedTaskProgress({
      phase: source.phase,
      taskType: source.runningTaskType,
      elapsedMs: Math.max(0, now - startMillis),
    })
  }, [key, now, source, startState])
}
