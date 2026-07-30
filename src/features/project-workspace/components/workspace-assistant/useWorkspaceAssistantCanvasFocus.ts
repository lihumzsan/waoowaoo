'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { ProjectAgentSessionState } from '@/lib/project-agent/session-state'
import type {
  WorkspaceAssistantActiveFocusRequest,
  WorkspaceAssistantActiveTaskTarget,
} from '../../workspace-assistant-focus'
import { resolveWorkspaceAssistantExternalTaskOperationId } from './workspace-assistant-panel-state'

function buildWorkspaceAssistantActiveTaskTarget(input: {
  readonly taskId: string | null | undefined
  readonly operationId: string | null
  readonly taskType: string | null | undefined
  readonly targetType: string | null | undefined
  readonly targetId: string | null | undefined
  readonly sourceKind?: string | null
}): WorkspaceAssistantActiveTaskTarget | null {
  const targetType = input.targetType?.trim()
  const targetId = input.targetId?.trim()
  const taskId = input.taskId?.trim()
  if (!taskId || !targetType || !targetId) return null
  const taskType = input.taskType?.trim()
  const operationId = input.operationId?.trim() || null
  return {
    taskId,
    targetType,
    targetId,
    ...(taskType ? { types: [taskType] } : {}),
    ...(operationId ? { operationId } : {}),
    ...(input.sourceKind !== undefined ? { sourceKind: input.sourceKind } : {}),
  }
}

function dedupeWorkspaceAssistantActiveTaskTargets(
  targets: readonly WorkspaceAssistantActiveTaskTarget[],
): readonly WorkspaceAssistantActiveTaskTarget[] {
  const byKey = new Map<string, WorkspaceAssistantActiveTaskTarget>()
  targets.forEach((target) => {
    byKey.set([
      target.operationId ?? '',
      target.taskId,
      target.targetType,
      target.targetId,
      (target.types ?? []).join(','),
      target.sourceKind ?? '',
    ].join(':'), target)
  })
  return Array.from(byKey.values())
}

interface UseWorkspaceAssistantCanvasFocusParams {
  readonly sessionState: ProjectAgentSessionState | null
  readonly storageLoading: boolean
  readonly onActiveOperationChange?: (focusRequest: WorkspaceAssistantActiveFocusRequest | null) => void
}

export function useWorkspaceAssistantCanvasFocus({
  sessionState,
  storageLoading,
  onActiveOperationChange,
}: UseWorkspaceAssistantCanvasFocusParams): void {
  const currentActivity = sessionState?.currentActivity ?? null
  const focusBatch = sessionState?.taskBatches[0] ?? null
  const batchTasks = useMemo(() => focusBatch?.tasks ?? [], [focusBatch])
  const activeExternalTaskOperationId = batchTasks.find((task) => Boolean(task.operationId))?.operationId
    ?? resolveWorkspaceAssistantExternalTaskOperationId(currentActivity)
    ?? null
  const activeTaskTargets = useMemo(() => {
    const targets = batchTasks.flatMap((task) => {
      const target = buildWorkspaceAssistantActiveTaskTarget({
        taskId: task.taskId,
        operationId: task.operationId,
        taskType: task.taskType,
        targetType: task.targetType,
        targetId: task.targetId,
        sourceKind: null,
      })
      return target ? [target] : []
    })
    return dedupeWorkspaceAssistantActiveTaskTargets(targets)
  }, [batchTasks])

  const externalTaskFocusRequest = useMemo<WorkspaceAssistantActiveFocusRequest | null>(() => (
    activeExternalTaskOperationId && focusBatch
      ? {
          operationId: activeExternalTaskOperationId,
          requestKey: `task-batch:${focusBatch.waitId}`,
          taskTargets: activeTaskTargets,
        }
      : null
  ), [activeExternalTaskOperationId, activeTaskTargets, focusBatch])

  const callbackRef = useRef(onActiveOperationChange)
  const signatureRef = useRef<string | null>(null)
  callbackRef.current = onActiveOperationChange
  useEffect(() => {
    const next = storageLoading ? null : externalTaskFocusRequest
    const signature = JSON.stringify(next)
    if (signatureRef.current === signature) return
    signatureRef.current = signature
    callbackRef.current?.(next)
  }, [externalTaskFocusRequest, storageLoading])
  useEffect(() => () => callbackRef.current?.(null), [])
}
