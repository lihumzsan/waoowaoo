import type { TaskExecutionData } from '@/lib/task/types'

/**
 * Transport-neutral input for every production Task handler.
 *
 * Queue/Workflow details do not enter handlers. They receive only canonical
 * Task facts, the current business attempt, cancellation and a liveness hook.
 */
export interface TaskExecutionContext {
  readonly data: TaskExecutionData
  readonly attempt: number
  readonly signal: AbortSignal
  readonly executionDeadlineMs: number | null
  readonly heartbeat: () => void
}

export type TaskExecutionResult = Record<string, unknown> | void

export type TaskExecutionHandler = (
  context: TaskExecutionContext,
) => Promise<TaskExecutionResult>
