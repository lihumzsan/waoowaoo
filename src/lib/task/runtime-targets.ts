import type { TaskType } from './types'

export type TaskRuntimePhase = 'idle' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'

export type TaskRuntimeTarget = {
  readonly targetType: string
  readonly targetId: string
  readonly types?: readonly string[]
}

export type TaskRuntimeStateLike = {
  readonly taskId?: string | null
  readonly targetType?: string | null
  readonly targetId?: string | null
  readonly phase: TaskRuntimePhase | string | null | undefined
  readonly runningTaskId?: string | null
  readonly runningTaskType?: string | null
  readonly progressGroupId?: string | null
  readonly progress?: number | null
  readonly stage?: string | null
  readonly stageLabel?: string | null
  readonly updatedAt?: string | null
  readonly lastError?: {
    readonly code?: string | null
  } | null
}

export function taskTargetPairKey(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`
}

export function taskRuntimeTargetPairKey(target: TaskRuntimeTarget): string {
  return taskTargetPairKey(target.targetType, target.targetId)
}

export function taskRuntimeTargetQueryKey(target: TaskRuntimeTarget): string {
  const types = (target.types || []).filter(Boolean).slice().sort()
  return `${target.targetType}:${target.targetId}:${types.join(',')}`
}

export function isTaskRuntimeRunningPhase(
  phase: string | null | undefined,
): phase is 'queued' | 'processing' {
  return phase === 'queued' || phase === 'processing'
}

export function isTaskRuntimeStateRunning(
  state: TaskRuntimeStateLike | null | undefined,
): boolean {
  return isTaskRuntimeRunningPhase(state?.phase)
    && typeof state?.runningTaskId === 'string'
    && state.runningTaskId.trim().length > 0
}

export function taskRuntimeStateMapSignature(
  map: ReadonlyMap<string, TaskRuntimeStateLike>,
): string {
  return Array.from(map.entries())
    .map(([key, state]) => [
      key,
      state.phase ?? '',
      state.runningTaskId ?? '',
      state.runningTaskType ?? '',
      state.progressGroupId ?? '',
      state.lastError?.code ?? '',
    ].join(':'))
    .sort()
    .join('|')
}

function target(
  targetType: string,
  targetId: string | null | undefined,
  types: readonly TaskType[],
): TaskRuntimeTarget | null {
  const normalizedTargetId = typeof targetId === 'string' ? targetId.trim() : ''
  if (!normalizedTargetId) return null
  return {
    targetType,
    targetId: normalizedTargetId,
    types,
  }
}

export const TASK_RUNTIME_TARGETS = {
  workspaceResource(resourceId: string | null | undefined, types: readonly TaskType[]) {
    return target('WorkspaceResource', resourceId, types)
  },
} as const
