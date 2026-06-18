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
  readonly progressGroupId?: string | null
  readonly updatedAt?: string | null
  readonly lastError?: {
    readonly code?: string | null
    readonly message?: string | null
  } | null
}

export const TASK_PROGRESS_START_STORAGE_PREFIX = 'waoowaoo:task-progress-start:'
const PROGRESS_TICK_MS = 1000
const TASK_PROGRESS_START_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_STORED_TASK_PROGRESS_STARTS = 120

interface StoredTaskProgressStartEntry {
  readonly key: string
  readonly storageKey: string
  readonly millis: number
}

function parseIsoMillis(value: string | null | undefined): number | null {
  if (!value) return null
  const millis = Date.parse(value)
  return Number.isFinite(millis) ? millis : null
}

function sanitizeStartMillis(value: number, now: number): number {
  if (!Number.isFinite(value) || value <= 0) return now
  return Math.min(value, now)
}

export function taskProgressKey(source: EstimatedTaskProgressSource | null | undefined): string | null {
  if (!source) return null
  const taskType = source.runningTaskType?.trim()
  if (!taskType) return null
  const progressGroupId = source.progressGroupId?.trim()
  if (progressGroupId) return `group:${progressGroupId}`
  const targetType = source.targetType?.trim()
  const targetId = source.targetId?.trim()
  if (targetType && targetId) return `target:${targetType}:${targetId}:${taskType}`
  const taskId = source.runningTaskId?.trim()
  if (taskId) return `task:${taskId}`
  return `type:${taskType}`
}

function taskProgressStorageKey(key: string): string {
  return `${TASK_PROGRESS_START_STORAGE_PREFIX}${key}`
}

function getTaskProgressStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function parseStoredEntry(storageKey: string, raw: string | null): StoredTaskProgressStartEntry | null {
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return {
    key: storageKey.slice(TASK_PROGRESS_START_STORAGE_PREFIX.length),
    storageKey,
    millis: parsed,
  }
}

function listStoredStartEntries(storage: Storage): {
  readonly entries: readonly StoredTaskProgressStartEntry[]
  readonly invalidStorageKeys: readonly string[]
} {
  const storageKeys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index)
    if (storageKey?.startsWith(TASK_PROGRESS_START_STORAGE_PREFIX)) {
      storageKeys.push(storageKey)
    }
  }

  const entries: StoredTaskProgressStartEntry[] = []
  const invalidStorageKeys: string[] = []
  storageKeys.forEach((storageKey) => {
    const entry = parseStoredEntry(storageKey, storage.getItem(storageKey))
    if (entry) {
      entries.push(entry)
    } else {
      invalidStorageKeys.push(storageKey)
    }
  })
  return { entries, invalidStorageKeys }
}

function removeStorageKeys(storage: Storage, storageKeys: readonly string[]) {
  storageKeys.forEach((storageKey) => {
    try {
      storage.removeItem(storageKey)
    } catch {
      // Storage is an optional cache for progress timing; removal failure must not break rendering.
    }
  })
}

export function pruneStoredStartMillis(storage: Storage, now: number, preserveStorageKey?: string): void {
  const { entries, invalidStorageKeys } = listStoredStartEntries(storage)
  const expiredBefore = now - TASK_PROGRESS_START_TTL_MS
  const expiredStorageKeys = entries
    .filter((entry) => entry.storageKey !== preserveStorageKey && entry.millis < expiredBefore)
    .map((entry) => entry.storageKey)

  const activeEntries = entries
    .filter((entry) => entry.storageKey === preserveStorageKey || entry.millis >= expiredBefore)
    .sort((left, right) => left.millis - right.millis)
  const overflowCount = Math.max(0, activeEntries.length - MAX_STORED_TASK_PROGRESS_STARTS)
  const overflowStorageKeys = activeEntries
    .filter((entry) => entry.storageKey !== preserveStorageKey)
    .slice(0, overflowCount)
    .map((entry) => entry.storageKey)

  removeStorageKeys(storage, [
    ...invalidStorageKeys,
    ...expiredStorageKeys,
    ...overflowStorageKeys,
  ])
}

function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError'
      || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || error.code === 22
      || error.code === 1014
  }
  if (!error || typeof error !== 'object') return false
  const record = error as { readonly name?: unknown; readonly code?: unknown }
  return record.name === 'QuotaExceededError'
    || record.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || record.code === 22
    || record.code === 1014
}

export function readStoredStartMillisFromStorage(storage: Storage, key: string, now: number): number | null {
  try {
    const entry = parseStoredEntry(taskProgressStorageKey(key), storage.getItem(taskProgressStorageKey(key)))
    if (!entry) return null
    return sanitizeStartMillis(entry.millis, now)
  } catch {
    return null
  }
}

export function writeStoredStartMillisToStorage(storage: Storage, key: string, value: number, now: number): boolean {
  const storageKey = taskProgressStorageKey(key)
  const storedValue = String(Math.floor(value))
  try {
    pruneStoredStartMillis(storage, now, storageKey)
    storage.setItem(storageKey, storedValue)
    return true
  } catch (error) {
    if (!isQuotaExceededError(error)) return false
  }

  try {
    pruneStoredStartMillis(storage, now, storageKey)
    storage.setItem(storageKey, storedValue)
    return true
  } catch {
    return false
  }
}

export function removeStoredStartMillisFromStorage(storage: Storage, key: string): void {
  try {
    storage.removeItem(taskProgressStorageKey(key))
  } catch {
    // Storage is an optional cache for progress timing; removal failure must not break rendering.
  }
}

function readStoredStartMillis(key: string, now: number): number | null {
  const storage = getTaskProgressStorage()
  return storage ? readStoredStartMillisFromStorage(storage, key, now) : null
}

function writeStoredStartMillis(key: string, value: number, now: number) {
  const storage = getTaskProgressStorage()
  if (!storage) return
  writeStoredStartMillisToStorage(storage, key, value, now)
}

function removeStoredStartMillis(key: string) {
  const storage = getTaskProgressStorage()
  if (!storage) return
  removeStoredStartMillisFromStorage(storage, key)
}

function shouldRemoveStoredStartMillisOnInactive(key: string): boolean {
  return !key.startsWith('group:')
}

function resolveInitialStartMillis(source: EstimatedTaskProgressSource, key: string, now: number): number {
  const stored = readStoredStartMillis(key, now)
  if (stored !== null) return sanitizeStartMillis(stored, now)
  const updatedAtMillis = parseIsoMillis(source.updatedAt)
  const startMillis = sanitizeStartMillis(updatedAtMillis ?? now, now)
  writeStoredStartMillis(key, startMillis, now)
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
    if (!source || !key) {
      setStartState(null)
      return
    }
    if (!active) {
      if (shouldRemoveStoredStartMillisOnInactive(key)) removeStoredStartMillis(key)
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
