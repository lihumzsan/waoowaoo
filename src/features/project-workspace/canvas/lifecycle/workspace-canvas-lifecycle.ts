import type { TaskRuntimeStateLike } from '@/lib/task/runtime-targets'
import type { WorkspaceCanvasStreamPresentation } from '../node-canvas-types'

export type WorkspaceCanvasLifecyclePhase =
  | 'pending'
  | 'submitting'
  | 'queued'
  | 'processing'
  | 'streaming'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export interface WorkspaceCanvasLifecycleError {
  readonly code: string
  readonly message: string
}

export interface WorkspaceCanvasLifecycle {
  readonly phase: WorkspaceCanvasLifecyclePhase
  readonly taskId: string | null
  readonly taskType: string | null
  readonly progress: number | null
  readonly error: WorkspaceCanvasLifecycleError | null
  readonly stream: WorkspaceCanvasStreamPresentation | null
}

export type WorkspaceCanvasPersistedPhase = 'pending' | 'succeeded' | 'failed' | 'canceled'

export interface WorkspaceCanvasLifecycleFacts {
  readonly persistedPhase: WorkspaceCanvasPersistedPhase
  readonly task: TaskRuntimeStateLike | null
  readonly stream: {
    readonly taskId: string
    readonly taskType: string | null
    readonly presentation: WorkspaceCanvasStreamPresentation
    readonly error: WorkspaceCanvasLifecycleError | null
  } | null
  readonly submitting: boolean
  readonly contractError?: WorkspaceCanvasLifecycleError | null
}

function readTaskId(task: TaskRuntimeStateLike | null): string | null {
  const taskId = task?.taskId ?? task?.runningTaskId
  return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : null
}

function readTaskType(task: TaskRuntimeStateLike | null): string | null {
  const taskType = task?.runningTaskType
  return typeof taskType === 'string' && taskType.trim() ? taskType.trim() : null
}

function readTaskError(task: TaskRuntimeStateLike | null): WorkspaceCanvasLifecycleError | null {
  const message = task?.lastError?.message
  if (typeof message !== 'string' || !message.trim()) return null
  const code = task?.lastError?.code
  return {
    code: typeof code === 'string' && code.trim() ? code.trim() : 'TASK_FAILED',
    message: message.trim(),
  }
}

function readTaskProgress(task: TaskRuntimeStateLike | null): number | null {
  const progress = task?.progress
  return typeof progress === 'number' && Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.floor(progress)))
    : null
}

function lifecycle(input: Omit<WorkspaceCanvasLifecycle, 'stream'> & {
  readonly stream?: WorkspaceCanvasStreamPresentation | null
}): WorkspaceCanvasLifecycle {
  return {
    ...input,
    stream: input.stream ?? null,
  }
}

/**
 * The only business lifecycle resolver for workspace canvas nodes.
 * It is intentionally pure: callers must provide resource, task, stream,
 * submission, and contract facts explicitly.
 */
export function resolveWorkspaceCanvasLifecycle(
  facts: WorkspaceCanvasLifecycleFacts,
): WorkspaceCanvasLifecycle {
  if (facts.contractError) {
    return lifecycle({
      phase: 'failed',
      taskId: readTaskId(facts.task) ?? facts.stream?.taskId ?? null,
      taskType: readTaskType(facts.task) ?? facts.stream?.taskType ?? null,
      progress: readTaskProgress(facts.task),
      error: facts.contractError,
    })
  }

  const taskId = readTaskId(facts.task)
  const taskType = readTaskType(facts.task)
  const streamMatchesTask = Boolean(
    facts.stream
    && taskId
    && facts.stream.taskId === taskId,
  )

  if (facts.task?.phase === 'queued' && taskId) {
    return lifecycle({
      phase: 'queued',
      taskId,
      taskType,
      progress: readTaskProgress(facts.task),
      error: null,
    })
  }

  if (facts.task?.phase === 'processing' && taskId) {
    if (streamMatchesTask && facts.stream) {
      return lifecycle({
        phase: facts.stream.error ? 'failed' : 'streaming',
        taskId,
        taskType: taskType ?? facts.stream.taskType,
        progress: readTaskProgress(facts.task),
        error: facts.stream.error,
        stream: facts.stream.presentation,
      })
    }
    return lifecycle({
      phase: 'processing',
      taskId,
      taskType,
      progress: readTaskProgress(facts.task),
      error: null,
    })
  }

  if (facts.task?.phase === 'failed') {
    return lifecycle({
      phase: 'failed',
      taskId,
      taskType,
      progress: readTaskProgress(facts.task),
      error: readTaskError(facts.task) ?? facts.stream?.error ?? {
        code: 'TASK_FAILED',
        message: 'Task failed',
      },
    })
  }

  if (facts.task?.phase === 'canceled' || facts.task?.phase === 'dismissed') {
    return lifecycle({
      phase: 'canceled',
      taskId,
      taskType,
      progress: readTaskProgress(facts.task),
      error: null,
    })
  }

  if (facts.task?.phase === 'completed') {
    if (facts.persistedPhase === 'pending') {
      return lifecycle({
        phase: 'failed',
        taskId,
        taskType,
        progress: readTaskProgress(facts.task),
        error: {
          code: 'CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING',
          message: 'Task completed without a materialized Canvas resource.',
        },
      })
    }
    return lifecycle({
      phase: facts.persistedPhase,
      taskId,
      taskType,
      progress: readTaskProgress(facts.task),
      error: null,
    })
  }

  if (facts.stream) {
    return lifecycle({
      phase: facts.stream.error ? 'failed' : 'streaming',
      taskId: facts.stream.taskId,
      taskType: facts.stream.taskType,
      progress: readTaskProgress(facts.task),
      error: facts.stream.error,
      stream: facts.stream.presentation,
    })
  }

  if (facts.submitting) {
    return lifecycle({
      phase: 'submitting',
      taskId: null,
      taskType: null,
      progress: null,
      error: null,
    })
  }

  return lifecycle({
    phase: facts.persistedPhase,
    taskId: null,
    taskType: null,
    progress: null,
    error: facts.persistedPhase === 'failed'
      ? readTaskError(facts.task)
      : null,
  })
}

export function isWorkspaceCanvasLifecycleRunning(
  lifecycleValue: WorkspaceCanvasLifecycle,
): boolean {
  return lifecycleValue.phase === 'submitting'
    || lifecycleValue.phase === 'queued'
    || lifecycleValue.phase === 'processing'
    || lifecycleValue.phase === 'streaming'
}

export function isWorkspaceCanvasLifecycleStreaming(
  lifecycleValue: WorkspaceCanvasLifecycle,
): boolean {
  return lifecycleValue.phase === 'streaming'
}

export function workspaceCanvasLifecycleStatusKey(
  lifecycleValue: WorkspaceCanvasLifecycle,
): 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled' {
  if (isWorkspaceCanvasLifecycleRunning(lifecycleValue)) return 'processing'
  switch (lifecycleValue.phase) {
    case 'pending':
    case 'succeeded':
    case 'failed':
    case 'canceled':
      return lifecycleValue.phase
    case 'submitting':
    case 'queued':
    case 'processing':
    case 'streaming':
      return 'processing'
  }
}

export function workspaceCanvasLifecycleTaskState(
  lifecycleValue: WorkspaceCanvasLifecycle,
): TaskRuntimeStateLike | null {
  if (!lifecycleValue.taskId) return null
  const phase = lifecycleValue.phase === 'streaming' ? 'processing' : lifecycleValue.phase
  return {
    phase,
    runningTaskId: lifecycleValue.taskId,
    runningTaskType: lifecycleValue.taskType,
    progress: lifecycleValue.progress,
    lastError: lifecycleValue.error,
  }
}
