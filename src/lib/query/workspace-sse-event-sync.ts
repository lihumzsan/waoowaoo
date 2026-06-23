import type { QueryClient } from '@tanstack/react-query'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, TASK_TYPE, WORKSPACE_SSE_EVENT_TYPE, type SSEEvent } from '@/lib/task/types'
import type { WorkspaceResourceName } from '@/lib/task/types'
import { isTaskIntent, resolveTaskIntent } from '@/lib/task/intent'
import { queryKeys } from './keys'
import { invalidateByTarget } from './invalidation/invalidate-by-target'
import { applyTaskLifecycleToOverlay } from './task-target-overlay'
import { applyTaskTargetTerminalStateToCache } from './task-target-state-cache'
import {
  extractWorkspaceResourceChangesFromTaskLifecycleEvent,
  isWorkspaceResourceName,
  workspaceResourceChangeFromName,
  syncWorkspaceResourceChanges,
} from './resource-change-sync'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isWorkspaceSSEEvent(value: unknown): value is SSEEvent {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.type === 'string'
    && typeof value.projectId === 'string'
    && typeof value.userId === 'string'
    && typeof value.ts === 'string'
}

export function readNumericWorkspaceSSEEventId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function applyWorkspaceSSEEvent(params: {
  queryClient: QueryClient
  event: SSEEvent
  projectId: string
  episodeId?: string | null
  isGlobalAssetProject: boolean
  scheduleTargetStatesInvalidation: () => void
}) {
  const { event, queryClient, projectId, episodeId, isGlobalAssetProject } = params

  if (event.type === WORKSPACE_SSE_EVENT_TYPE.MUTATION_BATCH) {
    const batchEpisodeId = typeof event.episodeId === 'string' ? event.episodeId : null
    const resolvedEpisodeId = batchEpisodeId || episodeId || null
    const seenTargetTypes = new Set<string>()
    for (const target of event.targets) {
      if (seenTargetTypes.has(target.targetType)) continue
      seenTargetTypes.add(target.targetType)
      invalidateByTarget({
        queryClient,
        projectId,
        targetType: target.targetType,
        episodeId: resolvedEpisodeId,
        isGlobalAssetProject,
      })
    }
    return
  }

  if (event.type === WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED) {
    const eventEpisodeId = typeof event.episodeId === 'string'
      ? event.episodeId
      : episodeId ?? null
    const resources: WorkspaceResourceName[] = event.resources
      .filter((resource): resource is WorkspaceResourceName => isWorkspaceResourceName(resource))
    const changes = resources
      .map((resource) => workspaceResourceChangeFromName({
        kind: resource,
        projectId: event.projectId,
        episodeId: eventEpisodeId,
      }))
      .filter((change) => change !== null)
    void syncWorkspaceResourceChanges({ queryClient, changes })
    return
  }

  const payloadRecord = isRecord(event.payload) ? event.payload : null
  const targetType = typeof event.targetType === 'string'
    ? event.targetType
    : typeof payloadRecord?.targetType === 'string'
      ? payloadRecord.targetType
      : null
  const targetId = typeof event.targetId === 'string'
    ? event.targetId
    : typeof payloadRecord?.targetId === 'string'
      ? payloadRecord.targetId
      : null
  const eventEpisodeId = typeof event.episodeId === 'string'
    ? event.episodeId
    : typeof payloadRecord?.episodeId === 'string'
      ? payloadRecord.episodeId
      : null
  const resolvedEpisodeId = eventEpisodeId || episodeId || null

  const rawLifecycleType: string | null =
    event.type === TASK_SSE_EVENT_TYPE.LIFECYCLE
      ? typeof payloadRecord?.lifecycleType === 'string'
        ? payloadRecord.lifecycleType
        : null
      : null
  const normalizedLifecycleType =
    rawLifecycleType === TASK_EVENT_TYPE.PROGRESS
      ? TASK_EVENT_TYPE.PROCESSING
      : rawLifecycleType
  const isLifecycleEvent = event.type === TASK_SSE_EVENT_TYPE.LIFECYCLE
  const shouldInvalidateTasksList =
    normalizedLifecycleType === TASK_EVENT_TYPE.CREATED ||
    normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED ||
    normalizedLifecycleType === TASK_EVENT_TYPE.FAILED ||
    (normalizedLifecycleType === TASK_EVENT_TYPE.PROCESSING &&
      typeof payloadRecord?.progress !== 'number')
  const shouldInvalidateTargetStates =
    normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED ||
    normalizedLifecycleType === TASK_EVENT_TYPE.FAILED

  if (isLifecycleEvent && shouldInvalidateTasksList) {
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
  }
  if (isLifecycleEvent && shouldInvalidateTargetStates) {
    params.scheduleTargetStatesInvalidation()
  }

  const payloadIntent = isTaskIntent(payloadRecord?.intent)
    ? payloadRecord.intent
    : resolveTaskIntent(typeof event.taskType === 'string' ? event.taskType : null)
  const payloadUi =
    payloadRecord?.ui && typeof payloadRecord.ui === 'object' && !Array.isArray(payloadRecord.ui)
      ? (payloadRecord.ui as Record<string, unknown>)
      : null
  const hasOutputAtStart =
    typeof payloadUi?.hasOutputAtStart === 'boolean'
      ? payloadUi.hasOutputAtStart
      : null
  const progressGroupId =
    typeof payloadUi?.progressGroupId === 'string' && payloadUi.progressGroupId.trim()
      ? payloadUi.progressGroupId.trim()
      : null
  const payloadErrorCode =
    typeof payloadRecord?.errorCode === 'string' && payloadRecord.errorCode.trim()
      ? payloadRecord.errorCode.trim()
      : null
  const payloadErrorMessage =
    typeof payloadRecord?.errorMessage === 'string' && payloadRecord.errorMessage.trim()
      ? payloadRecord.errorMessage.trim()
      : typeof payloadRecord?.message === 'string' && payloadRecord.message.trim()
        ? payloadRecord.message.trim()
        : null

  applyTaskLifecycleToOverlay(queryClient, {
    projectId,
    lifecycleType: normalizedLifecycleType,
    targetType,
    targetId,
    taskId: typeof event.taskId === 'string' ? event.taskId : null,
    taskType: typeof event.taskType === 'string' ? event.taskType : null,
    progressGroupId,
    intent: payloadIntent,
    hasOutputAtStart,
    progress: typeof payloadRecord?.progress === 'number' ? Math.floor(payloadRecord.progress) : null,
    stage: typeof payloadRecord?.stage === 'string' ? payloadRecord.stage : null,
    stageLabel: typeof payloadRecord?.stageLabel === 'string' ? payloadRecord.stageLabel : null,
    eventTs: typeof event.ts === 'string' ? event.ts : null,
  })

  if (
    normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED ||
    normalizedLifecycleType === TASK_EVENT_TYPE.FAILED
  ) {
    applyTaskTargetTerminalStateToCache(queryClient, {
      projectId,
      targetType,
      targetId,
      phase: normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED ? 'completed' : 'failed',
      taskId: typeof event.taskId === 'string' ? event.taskId : null,
      taskType: typeof event.taskType === 'string' ? event.taskType : null,
      progressGroupId,
      intent: payloadIntent,
      hasOutputAtStart,
      progress: typeof payloadRecord?.progress === 'number' ? Math.floor(payloadRecord.progress) : null,
      stage: typeof payloadRecord?.stage === 'string' ? payloadRecord.stage : null,
      stageLabel: typeof payloadRecord?.stageLabel === 'string' ? payloadRecord.stageLabel : null,
      errorCode: payloadErrorCode,
      errorMessage: payloadErrorMessage,
      eventTs: typeof event.ts === 'string' ? event.ts : null,
    })
  }

  if (
    normalizedLifecycleType === TASK_EVENT_TYPE.PROCESSING &&
    event.taskType === TASK_TYPE.EDIT_SCRIPT_GENERATE &&
    resolvedEpisodeId
  ) {
    queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, resolvedEpisodeId) })
  }

  if (
    (
      normalizedLifecycleType === TASK_EVENT_TYPE.CREATED ||
      normalizedLifecycleType === TASK_EVENT_TYPE.PROCESSING
    ) &&
    (
      event.taskType === TASK_TYPE.EDIT_SCREENPLAY_GENERATE ||
      event.taskType === TASK_TYPE.EDIT_SCREENPLAY_REVISE
    ) &&
    resolvedEpisodeId
  ) {
    queryClient.invalidateQueries({ queryKey: queryKeys.project.editScreenplay(projectId, resolvedEpisodeId) })
  }

  if (
    normalizedLifecycleType === TASK_EVENT_TYPE.CREATED ||
    normalizedLifecycleType === TASK_EVENT_TYPE.PROCESSING
  ) {
    return
  }

  if (
    normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED ||
    normalizedLifecycleType === TASK_EVENT_TYPE.FAILED
  ) {
    const resourceChanges = extractWorkspaceResourceChangesFromTaskLifecycleEvent({
      taskType: typeof event.taskType === 'string' ? event.taskType : null,
      lifecycleType: normalizedLifecycleType,
      projectId,
      targetType,
      targetId,
      episodeId: resolvedEpisodeId,
      payload: payloadRecord,
    })
    if (resourceChanges.length > 0) {
      void syncWorkspaceResourceChanges({ queryClient, changes: resourceChanges })
    } else {
      invalidateByTarget({
        queryClient,
        projectId,
        targetType,
        episodeId: resolvedEpisodeId,
        isGlobalAssetProject,
      })
    }
  }
}
