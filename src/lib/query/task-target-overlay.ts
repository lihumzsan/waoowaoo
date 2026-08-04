import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import type { TaskIntent } from '@/lib/task/intent'

export type TaskTargetOverlayPhase = 'queued' | 'processing'

export type TaskTargetOverlayState = {
  targetType: string
  targetId: string
  phase: TaskTargetOverlayPhase
  runningTaskId: string | null
  runningTaskType: string | null
  progressGroupId?: string | null
  intent: TaskIntent
  hasOutputAtStart: boolean | null
  progress: number | null
  stage: string | null
  stageLabel: string | null
  updatedAt: string | null
  lastError: null
}

export type TaskTargetOverlayMap = Record<string, TaskTargetOverlayState>

function toOverlayKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function upsertTaskTargetOverlay(
  queryClient: QueryClient,
  params: {
    projectId: string
    targetType: string
    targetId: string
    phase?: TaskTargetOverlayPhase
    runningTaskId?: string | null
    runningTaskType?: string | null
    progressGroupId?: string | null
    intent?: TaskIntent
    hasOutputAtStart?: boolean | null
    progress?: number | null
    stage?: string | null
    stageLabel?: string | null
    updatedAt?: string | null
  },
) {
  const now = Date.now()
  const incomingTaskId = normalizeOptionalString(params.runningTaskId)
  if (!incomingTaskId) return
  const key = toOverlayKey(params.targetType, params.targetId)
  queryClient.setQueryData<TaskTargetOverlayMap>(
    queryKeys.tasks.targetStateOverlay(params.projectId),
    (prev) => {
      const next: TaskTargetOverlayMap = { ...(prev || {}) }
      const existing = next[key]
      const runningTaskId = incomingTaskId
      const runningTaskType = normalizeOptionalString(params.runningTaskType)
        || normalizeOptionalString(existing?.runningTaskType)
      const progressGroupId = normalizeOptionalString(params.progressGroupId)
        || normalizeOptionalString(existing?.progressGroupId)
      next[key] = {
        targetType: params.targetType,
        targetId: params.targetId,
        phase: params.phase || 'queued',
        runningTaskId,
        runningTaskType,
        progressGroupId,
        intent: params.intent || 'process',
        hasOutputAtStart: params.hasOutputAtStart ?? null,
        progress: params.progress ?? null,
        stage: params.stage ?? null,
        stageLabel: params.stageLabel ?? null,
        updatedAt: params.updatedAt || new Date(now).toISOString(),
        lastError: null,
      }
      return next
    },
  )
}

export function clearTaskTargetOverlay(
  queryClient: QueryClient,
  params: {
    projectId: string
    targetType: string
    targetId: string
  },
) {
  const key = toOverlayKey(params.targetType, params.targetId)
  queryClient.setQueryData<TaskTargetOverlayMap>(
    queryKeys.tasks.targetStateOverlay(params.projectId),
    (prev) => {
      if (!prev || !prev[key]) return prev || {}
      const next: TaskTargetOverlayMap = { ...prev }
      delete next[key]
      return next
    },
  )
}

export function applyTaskLifecycleToOverlay(
  queryClient: QueryClient,
  params: {
    projectId: string
    lifecycleType: string | null
    targetType: string | null
    targetId: string | null
    taskId: string | null
    taskType: string | null
    progressGroupId?: string | null
    intent: TaskIntent
    hasOutputAtStart: boolean | null
    progress: number | null
    stage: string | null
    stageLabel: string | null
    eventTs: string | null
  },
) {
  if (!params.targetType || !params.targetId) return
  if (params.lifecycleType === TASK_EVENT_TYPE.CREATED) {
    upsertTaskTargetOverlay(queryClient, {
      projectId: params.projectId,
      targetType: params.targetType,
      targetId: params.targetId,
      phase: 'queued',
      runningTaskId: params.taskId,
      runningTaskType: params.taskType,
      progressGroupId: params.progressGroupId,
      intent: params.intent,
      hasOutputAtStart: params.hasOutputAtStart,
      progress: params.progress,
      stage: params.stage,
      stageLabel: params.stageLabel,
      updatedAt: params.eventTs,
    })
    return
  }

  if (params.lifecycleType === TASK_EVENT_TYPE.PROCESSING) {
    upsertTaskTargetOverlay(queryClient, {
      projectId: params.projectId,
      targetType: params.targetType,
      targetId: params.targetId,
      phase: 'processing',
      runningTaskId: params.taskId,
      runningTaskType: params.taskType,
      progressGroupId: params.progressGroupId,
      intent: params.intent,
      hasOutputAtStart: params.hasOutputAtStart,
      progress: params.progress,
      stage: params.stage,
      stageLabel: params.stageLabel,
      updatedAt: params.eventTs,
    })
    return
  }

  if (
    params.lifecycleType === TASK_EVENT_TYPE.COMPLETED ||
    params.lifecycleType === TASK_EVENT_TYPE.FAILED ||
    params.lifecycleType === TASK_EVENT_TYPE.CANCELED
  ) {
    const key = toOverlayKey(params.targetType, params.targetId)
    queryClient.setQueryData<TaskTargetOverlayMap>(
      queryKeys.tasks.targetStateOverlay(params.projectId),
      (prev) => {
        const incomingTaskId = normalizeOptionalString(params.taskId)
        if (!prev) return {}
        const next: TaskTargetOverlayMap = { ...prev }
        let changed = false

        for (const [overlayKey, current] of Object.entries(prev)) {
          const currentTaskId = normalizeOptionalString(current.runningTaskId)
          const isEventTarget = overlayKey === key
          const matchesTerminalTask = Boolean(incomingTaskId && currentTaskId === incomingTaskId)
          const matchesEventTargetWithoutTask = isEventTarget && !incomingTaskId
          if (!matchesTerminalTask && !matchesEventTargetWithoutTask) continue

          delete next[overlayKey]
          changed = true
        }

        return changed ? next : prev
      },
    )
  }
}
