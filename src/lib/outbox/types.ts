import { requireWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'

export const OUTBOX_COMMAND_KIND = {
  TASK_ENQUEUE: 'task.enqueue',
  TASK_LIFECYCLE_BROADCAST: 'task.lifecycle.broadcast',
  PROJECT_AGENT_CONTINUE_WAIT: 'project_agent.continue_wait',
  PROJECT_AGENT_SESSION_BROADCAST: 'project_agent.session_broadcast',
  WORKSPACE_RESOURCE_BROADCAST: 'workspace_resource.broadcast',
} as const

export type OutboxCommandKind = (typeof OUTBOX_COMMAND_KIND)[keyof typeof OUTBOX_COMMAND_KIND]

export type TaskLifecycleBroadcastCommand = {
  kind: typeof OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST
  eventId: number
  taskId: string
}

export type TaskEnqueueCommand = {
  kind: typeof OUTBOX_COMMAND_KIND.TASK_ENQUEUE
  taskId: string
  operationExecutionId: string | null
}

export type ProjectAgentContinueWaitCommand = {
  kind: typeof OUTBOX_COMMAND_KIND.PROJECT_AGENT_CONTINUE_WAIT
  waitId: string
  runId: string
  expectedRunVersion: number
  expectedEventSeq: string
}

export type ProjectAgentSessionBroadcastCommand = {
  kind: typeof OUTBOX_COMMAND_KIND.PROJECT_AGENT_SESSION_BROADCAST
  projectAgentEventId: string
}

export type WorkspaceResourceBroadcastCommand = {
  kind: typeof OUTBOX_COMMAND_KIND.WORKSPACE_RESOURCE_BROADCAST
  projectId: string
  userId: string
  operationId: string
  affectedResources: import('@/lib/task/types').WorkspaceResourceRef[]
}

export type OutboxCommandPayload =
  | TaskEnqueueCommand
  | TaskLifecycleBroadcastCommand
  | ProjectAgentContinueWaitCommand
  | ProjectAgentSessionBroadcastCommand
  | WorkspaceResourceBroadcastCommand

export type CreateOutboxCommandInput = {
  idempotencyKey: string
  aggregateType: 'task' | 'project_agent_wait' | 'project_agent_event' | 'workspace_resource'
  aggregateId: string
  payload: OutboxCommandPayload
  availableAt?: Date
}

export class OutboxPermanentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboxPermanentError'
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OUTBOX_COMMAND_PAYLOAD_INVALID')
  }
  return value as Record<string, unknown>
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`OUTBOX_COMMAND_${key.toUpperCase()}_INVALID`)
  }
  return value
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value === null) return null
  return readRequiredString(record, key)
}

function readRequiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`OUTBOX_COMMAND_${key.toUpperCase()}_INVALID`)
  }
  return value
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = readRequiredInteger(record, key)
  if (value < 0) throw new Error(`OUTBOX_COMMAND_${key.toUpperCase()}_NEGATIVE`)
  return value
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = readRequiredInteger(record, key)
  if (value <= 0) throw new Error(`OUTBOX_COMMAND_${key.toUpperCase()}_NOT_POSITIVE`)
  return value
}

function readCanonicalBigIntString(record: Record<string, unknown>, key: string): string {
  const value = readRequiredString(record, key)
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`OUTBOX_COMMAND_${key.toUpperCase()}_INVALID_BIGINT`)
  }
  return value
}

export function parseOutboxCommandPayload(value: unknown): OutboxCommandPayload {
  const record = readRecord(value)
  const kind = readRequiredString(record, 'kind')

  switch (kind) {
    case OUTBOX_COMMAND_KIND.TASK_ENQUEUE:
      return {
        kind,
        taskId: readRequiredString(record, 'taskId'),
        operationExecutionId: readNullableString(record, 'operationExecutionId'),
      }
    case OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST:
      return {
        kind,
        eventId: readPositiveInteger(record, 'eventId'),
        taskId: readRequiredString(record, 'taskId'),
      }
    case OUTBOX_COMMAND_KIND.PROJECT_AGENT_CONTINUE_WAIT:
      return {
        kind,
        waitId: readRequiredString(record, 'waitId'),
        runId: readRequiredString(record, 'runId'),
        expectedRunVersion: readNonNegativeInteger(record, 'expectedRunVersion'),
        expectedEventSeq: readCanonicalBigIntString(record, 'expectedEventSeq'),
      }
    case OUTBOX_COMMAND_KIND.PROJECT_AGENT_SESSION_BROADCAST:
      return {
        kind,
        projectAgentEventId: readCanonicalBigIntString(record, 'projectAgentEventId'),
      }
    case OUTBOX_COMMAND_KIND.WORKSPACE_RESOURCE_BROADCAST: {
      const projectId = readRequiredString(record, 'projectId')
      const affectedResources = requireWorkspaceResourceRefs(record.affectedResources)
      if (affectedResources.length === 0) {
        throw new Error('OUTBOX_COMMAND_AFFECTED_RESOURCES_EMPTY')
      }
      if (affectedResources.some((ref) => ref.projectId !== projectId)) {
        throw new Error('OUTBOX_COMMAND_AFFECTED_RESOURCES_PROJECT_MISMATCH')
      }
      return {
        kind,
        projectId,
        userId: readRequiredString(record, 'userId'),
        operationId: readRequiredString(record, 'operationId'),
        affectedResources,
      }
    }
    default:
      throw new Error(`OUTBOX_COMMAND_KIND_UNSUPPORTED:${kind}`)
  }
}
