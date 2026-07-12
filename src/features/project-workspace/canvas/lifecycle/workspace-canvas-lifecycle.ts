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
  } | null
  readonly submitting: boolean
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

function readTaskError(task: TaskRuntimeStateLike | null): WorkspaceCanvasLifecycleError | null {
  const lastError = task?.lastError
  if (lastError === null || lastError === undefined) return null
  const message = lastError.message
  if (typeof message !== 'string' || !message.trim()) return null
  const code = lastError.code
  return {
    code: typeof code === 'string' && code.trim() ? code.trim() : 'TASK_FAILED',
    message: message.trim(),
  }
}

function readTaskProgress(task: TaskRuntimeStateLike | null): number | null {
  const progress = task?.progress as number
  return Number.isFinite(progress)
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
        phase: 'streaming',
        taskId,
        taskType: taskType ?? facts.stream.taskType,
        progress: readTaskProgress(facts.task),
        error: null,
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
      error: readTaskError(facts.task) ?? {
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
      phase: 'streaming',
      taskId: facts.stream.taskId,
      taskType: facts.stream.taskType,
      progress: readTaskProgress(facts.task),
      error: null,
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
