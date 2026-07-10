import type { QueryClient } from '@tanstack/react-query'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, TASK_TYPE, WORKSPACE_SSE_EVENT_TYPE, type SSEEvent } from '@/lib/task/types'
import { isTaskIntent, resolveTaskIntent } from '@/lib/task/intent'
import { readTaskCoveredTargets, type TaskCoveredTarget } from '@/lib/task/covered-targets'
import { queryKeys } from './keys'
import { invalidateByTarget } from './invalidation/invalidate-by-target'
import { applyTaskLifecycleToOverlay } from './task-target-overlay'
import { applyTaskTargetTerminalStateToCache } from './task-target-state-cache'
import { syncWorkspaceResourceChanges } from './resource-change-sync'
import { readWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import { applyWorkspaceMaterializedResourcesToCache } from './materialized-resource-cache'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function resolveLifecycleTargets(input: {
  readonly targetType: string | null
  readonly targetId: string | null
  readonly payload: Record<string, unknown> | null
}): readonly TaskCoveredTarget[] {
  const coveredTargets = readTaskCoveredTargets(input.payload?.coveredTargets)
  if (coveredTargets.length > 0) return coveredTargets
  return input.targetType && input.targetId
    ? [{ targetType: input.targetType, targetId: input.targetId }]
    : []
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
    const changes = readWorkspaceResourceRefs(event.affectedResources)
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

  const materializedResult = (
    normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED
    || normalizedLifecycleType === TASK_EVENT_TYPE.FAILED
  )
    ? applyWorkspaceMaterializedResourcesToCache({
        queryClient,
        taskId: event.taskId,
        projectId,
        value: payloadRecord?.materializedResources,
      })
    : { applied: [], errors: [] }
  const missingCompletedHandoff = normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED
    && Boolean(resolvedEpisodeId)
    && materializedResult.applied.length === 0
  const terminalHandoffError = materializedResult.errors[0]
    ?? (missingCompletedHandoff ? 'CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING' : null)

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
  const lifecycleTargets = resolveLifecycleTargets({
    targetType,
    targetId,
    payload: payloadRecord,
  })

  for (const lifecycleTarget of lifecycleTargets) {
    applyTaskLifecycleToOverlay(queryClient, {
      projectId,
      lifecycleType: normalizedLifecycleType,
      targetType: lifecycleTarget.targetType,
      targetId: lifecycleTarget.targetId,
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
  }

  if (
    normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED ||
    normalizedLifecycleType === TASK_EVENT_TYPE.FAILED
  ) {
    for (const lifecycleTarget of lifecycleTargets) {
      applyTaskTargetTerminalStateToCache(queryClient, {
        projectId,
        targetType: lifecycleTarget.targetType,
        targetId: lifecycleTarget.targetId,
        phase: normalizedLifecycleType === TASK_EVENT_TYPE.COMPLETED ? 'completed' : 'failed',
        taskId: typeof event.taskId === 'string' ? event.taskId : null,
        taskType: typeof event.taskType === 'string' ? event.taskType : null,
        progressGroupId,
        intent: payloadIntent,
        hasOutputAtStart,
        progress: typeof payloadRecord?.progress === 'number' ? Math.floor(payloadRecord.progress) : null,
        stage: typeof payloadRecord?.stage === 'string' ? payloadRecord.stage : null,
        stageLabel: typeof payloadRecord?.stageLabel === 'string' ? payloadRecord.stageLabel : null,
        errorCode: terminalHandoffError ?? payloadErrorCode,
        errorMessage: terminalHandoffError
          ? 'Task reached completed without a valid materialized Canvas resource.'
          : payloadErrorMessage,
        eventTs: typeof event.ts === 'string' ? event.ts : null,
      })
    }
  }

  if (
    normalizedLifecycleType === TASK_EVENT_TYPE.PROCESSING &&
    event.taskType === TASK_TYPE.EDIT_SCRIPT_GENERATE &&
    resolvedEpisodeId
  ) {
    queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, resolvedEpisodeId) })
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
    const resourceChanges = readWorkspaceResourceRefs(payloadRecord?.affectedResources)
    if (resourceChanges.length > 0) {
      void syncWorkspaceResourceChanges({ queryClient, changes: resourceChanges })
    }
  }
}
