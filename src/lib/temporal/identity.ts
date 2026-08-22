import { sha256Base64Url } from '../sha256'

function requireIdentityPart(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized || normalized !== value) throw new Error(code)
  return normalized
}

function hashIdentity(value: string): string {
  return sha256Base64Url(value)
}

export function buildTaskWorkflowId(taskId: string): string {
  return `task:v1:${hashIdentity(
    requireIdentityPart(taskId, 'TASK_ID_INVALID'),
  )}`
}

export function buildUserTaskSchedulerWorkflowId(userId: string): string {
  return `task-scheduler:v1:${hashIdentity(
    requireIdentityPart(userId, 'TASK_USER_ID_INVALID'),
  )}`
}

export function buildOperationExecutionWorkflowId(
  executionId: string,
): string {
  return `operation-execution:v1:${hashIdentity(
    requireIdentityPart(executionId, 'OPERATION_EXECUTION_ID_INVALID'),
  )}`
}
