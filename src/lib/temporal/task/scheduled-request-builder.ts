import { createHash } from 'node:crypto'
import { isTaskType } from '@/lib/task/types'
import { buildTaskWorkflowId, buildUserTaskSchedulerWorkflowId } from '../identity'
import type {
  PersistedTaskReference,
  ScheduledTaskRequest,
  TaskWorkflowInput,
} from './contracts'

function requireIdentity(value: string, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized !== value) throw new Error(code)
  return normalized
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function buildTaskWorkflowInput(reference: PersistedTaskReference): TaskWorkflowInput {
  const taskId = requireIdentity(reference.taskId, 'TASK_ID_INVALID')
  const userId = requireIdentity(reference.userId, 'TASK_USER_ID_INVALID')
  if (!isTaskType(reference.taskType)) {
    throw new Error(`TASK_TYPE_INVALID:${String(reference.taskType)}`)
  }
  return {
    workflowId: buildTaskWorkflowId(taskId),
    schedulerWorkflowId: buildUserTaskSchedulerWorkflowId(userId),
    taskId,
    userId,
    taskType: reference.taskType,
  }
}

export function buildScheduledTaskRequest(
  reference: PersistedTaskReference,
): ScheduledTaskRequest {
  const task = buildTaskWorkflowInput(reference)
  const dependsOnTaskIds = reference.dependsOnTaskIds.map((dependencyTaskId) =>
    requireIdentity(dependencyTaskId, 'TASK_DEPENDENCY_TASK_ID_INVALID'),
  )
  if (
    dependsOnTaskIds.includes(task.taskId) ||
    new Set(dependsOnTaskIds).size !== dependsOnTaskIds.length
  ) {
    throw new Error('TASK_DEPENDENCY_TOPOLOGY_DIVERGED')
  }
  dependsOnTaskIds.sort()
  return {
    enqueueId: `task-enqueue:v1:${hash(task.taskId)}`,
    task,
    dependsOnTaskIds,
  }
}
