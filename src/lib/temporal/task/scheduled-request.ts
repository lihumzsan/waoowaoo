import type { ScheduledTaskRequest } from './contracts'

export function sameScheduledTask(
  left: ScheduledTaskRequest,
  right: ScheduledTaskRequest,
): boolean {
  return (
    left.enqueueId === right.enqueueId &&
    left.task.workflowId === right.task.workflowId &&
    left.task.schedulerWorkflowId === right.task.schedulerWorkflowId &&
    left.task.taskId === right.task.taskId &&
    left.task.userId === right.task.userId &&
    left.task.taskType === right.task.taskType &&
    left.dependsOnTaskIds.length === right.dependsOnTaskIds.length &&
    left.dependsOnTaskIds.every(
      (dependencyTaskId, index) => dependencyTaskId === right.dependsOnTaskIds[index],
    )
  )
}

export function validateTaskSchedulerAdmissionDependencies(
  input: ScheduledTaskRequest,
  targetTaskId: string,
  persistedDependencyTaskIds: readonly string[],
): void {
  const requestedDependencyTaskIds = [...input.dependsOnTaskIds].sort()
  if (
    requestedDependencyTaskIds.some(
      (dependencyTaskId) =>
        dependencyTaskId.trim() !== dependencyTaskId || dependencyTaskId.length === 0,
    ) ||
    new Set(requestedDependencyTaskIds).size !== requestedDependencyTaskIds.length ||
    requestedDependencyTaskIds.includes(targetTaskId) ||
    JSON.stringify(requestedDependencyTaskIds) !== JSON.stringify(persistedDependencyTaskIds)
  ) {
    throw new Error('TASK_DEPENDENCY_TOPOLOGY_DIVERGED')
  }
}
