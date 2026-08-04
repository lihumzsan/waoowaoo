import type { TaskRuntimeStateLike } from '@/lib/task/runtime-targets'

export type WorkspaceCanvasLifecyclePhase =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export interface WorkspaceCanvasLifecycleError {
  readonly code: string
}

export interface WorkspaceCanvasLifecycle {
  readonly phase: WorkspaceCanvasLifecyclePhase
  readonly taskId: string | null
  readonly taskType: string | null
  readonly progress: number | null
  readonly error: WorkspaceCanvasLifecycleError | null
}

export type WorkspaceCanvasPersistedPhase = 'pending' | 'succeeded' | 'failed' | 'canceled'

export interface WorkspaceCanvasLifecycleFacts {
  readonly persistedPhase: WorkspaceCanvasPersistedPhase
  readonly task: TaskRuntimeStateLike | null
  readonly contractError?: WorkspaceCanvasLifecycleError | null
}

function normalizeIdentity(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function readTaskId(task: TaskRuntimeStateLike | null): string | null {
  return normalizeIdentity(task?.taskId) ?? normalizeIdentity(task?.runningTaskId)
}

function readTaskType(task: TaskRuntimeStateLike | null): string | null {
  return normalizeIdentity(task?.runningTaskType)
}

function readTaskProgress(task: TaskRuntimeStateLike | null): number | null {
  const progress = task?.progress
  return typeof progress === 'number' && Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.floor(progress)))
    : null
}

function readTaskError(task: TaskRuntimeStateLike | null): WorkspaceCanvasLifecycleError {
  const code = task?.lastError?.code
  return {
    code: typeof code === 'string' && code.trim() ? code.trim() : 'TASK_FAILED',
  }
}

/** The single resolver for a Resource card's persisted and Task lifecycle facts. */
export function resolveWorkspaceCanvasLifecycle(
  facts: WorkspaceCanvasLifecycleFacts,
): WorkspaceCanvasLifecycle {
  const taskId = readTaskId(facts.task)
  const taskType = readTaskType(facts.task)
  const progress = readTaskProgress(facts.task)

  if (facts.contractError) {
    return { phase: 'failed', taskId, taskType, progress, error: facts.contractError }
  }
  if (facts.task?.phase === 'queued' && taskId) {
    return { phase: 'queued', taskId, taskType, progress, error: null }
  }
  if (facts.task?.phase === 'processing' && taskId) {
    return { phase: 'processing', taskId, taskType, progress, error: null }
  }
  if (facts.task?.phase === 'failed') {
    return { phase: 'failed', taskId, taskType, progress, error: readTaskError(facts.task) }
  }
  if (facts.task?.phase === 'canceled' || facts.task?.phase === 'dismissed') {
    return { phase: 'canceled', taskId, taskType, progress, error: null }
  }
  return { phase: facts.persistedPhase, taskId, taskType, progress, error: null }
}

export function isWorkspaceCanvasLifecycleRunning(lifecycle: WorkspaceCanvasLifecycle): boolean {
  return lifecycle.phase === 'queued' || lifecycle.phase === 'processing'
}

/**
 * User-facing generation stage for an in-flight card. Derived only from the
 * resolved lifecycle; renderers must not reinterpret phases. `saving` is the
 * declared slot for a finer terminal-persistence runtime fact and maps here
 * once the Task runtime exposes it.
 */
export type WorkspaceCanvasGenerationStage = 'submitted' | 'queued' | 'generating' | 'saving'

export function workspaceCanvasGenerationStage(
  lifecycle: WorkspaceCanvasLifecycle,
): WorkspaceCanvasGenerationStage | null {
  if (lifecycle.phase === 'pending') return 'submitted'
  if (lifecycle.phase === 'queued') return 'queued'
  if (lifecycle.phase === 'processing') return 'generating'
  return null
}

export function workspaceCanvasLifecycleStatusKey(lifecycle: WorkspaceCanvasLifecycle): WorkspaceCanvasLifecyclePhase {
  return lifecycle.phase
}

export function workspaceCanvasLifecycleTaskState(lifecycle: WorkspaceCanvasLifecycle): TaskRuntimeStateLike | null {
  if (!lifecycle.taskId) return null
  return {
    taskId: lifecycle.taskId,
    runningTaskId: lifecycle.taskId,
    runningTaskType: lifecycle.taskType,
    phase: lifecycle.phase,
    progress: lifecycle.progress,
    lastError: lifecycle.error,
  }
}
