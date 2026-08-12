import type { TaskCancelRequest, TaskWorkflowTerminalStatus } from './contracts'

export interface SchedulerDependencyCompletion {
  readonly taskId: string
  readonly taskWorkflowId: string
  readonly status: TaskWorkflowTerminalStatus
  readonly terminalEventId: number
  readonly cancellation?: TaskCancelRequest
}

export type RequiredSuccessDependencyDecision =
  | { readonly kind: 'run' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'cancel'; readonly failedTaskIds: readonly string[] }

export function resolveRequiredSuccessDependencyDecision(
  dependencyTaskIds: readonly string[],
  completionByTaskId: ReadonlyMap<string, SchedulerDependencyCompletion>,
): RequiredSuccessDependencyDecision {
  const failedTaskIds = dependencyTaskIds
    .filter((taskId) => {
      const status = completionByTaskId.get(taskId)?.status
      return status === 'failed' || status === 'canceled'
    })
    .sort()

  if (failedTaskIds.length > 0) return { kind: 'cancel', failedTaskIds }
  if (
    dependencyTaskIds.every(
      (taskId) => completionByTaskId.get(taskId)?.status === 'completed',
    )
  ) {
    return { kind: 'run' }
  }
  return { kind: 'wait' }
}

export function retainSchedulerCompletions(input: {
  readonly queuedDependencyTaskIds: ReadonlySet<string>
  readonly completions: readonly SchedulerDependencyCompletion[]
  readonly replayLimit: number
}): readonly SchedulerDependencyCompletion[] {
  const recent = input.completions.slice(-input.replayLimit)
  const retainedTaskIds = new Set(recent.map((item) => item.taskId))
  return [
    ...input.completions.filter(
      (item) =>
        input.queuedDependencyTaskIds.has(item.taskId) && !retainedTaskIds.has(item.taskId),
    ),
    ...recent,
  ]
}
