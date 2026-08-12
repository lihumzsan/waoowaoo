import { createHash } from 'node:crypto'
import { buildTaskWorkflowId, buildUserTaskSchedulerWorkflowId } from '../identity'
import type { PersistedTaskReference, ScheduledTaskRequest } from './contracts'

export class TaskDependencyTopologyDivergedError extends Error {
  constructor(...details: readonly string[]) {
    super(['TASK_DEPENDENCY_TOPOLOGY_DIVERGED', ...details].join(':'))
    this.name = 'TaskDependencyTopologyDivergedError'
  }
}

export function isTaskDependencyTopologyDivergedError(
  error: unknown,
): error is TaskDependencyTopologyDivergedError {
  return error instanceof TaskDependencyTopologyDivergedError
}

function topologyDiverged(): never {
  throw new TaskDependencyTopologyDivergedError()
}

function buildTaskEnqueueId(taskId: string): string {
  const digest = createHash('sha256').update(taskId, 'utf8').digest('base64url')
  return `task-enqueue:v1:${digest}`
}

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
    topologyDiverged()
  }
}

export function validateTaskSchedulerAdmission(
  input: ScheduledTaskRequest,
  persistedReference: PersistedTaskReference,
): void {
  const expected: ScheduledTaskRequest = {
    enqueueId: buildTaskEnqueueId(persistedReference.taskId),
    task: {
      workflowId: buildTaskWorkflowId(persistedReference.taskId),
      schedulerWorkflowId: buildUserTaskSchedulerWorkflowId(persistedReference.userId),
      taskId: persistedReference.taskId,
      userId: persistedReference.userId,
      taskType: persistedReference.taskType,
    },
    dependsOnTaskIds: [...persistedReference.dependsOnTaskIds],
  }
  validateTaskSchedulerAdmissionDependencies(
    input,
    expected.task.taskId,
    expected.dependsOnTaskIds,
  )
  if (!sameScheduledTask(input, expected)) topologyDiverged()
}
