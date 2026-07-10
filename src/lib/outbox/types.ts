export const OUTBOX_COMMAND_KIND = {
  TASK_LIFECYCLE_BROADCAST: 'task.lifecycle.broadcast',
  PROJECT_AGENT_CONTINUE_WAIT: 'project_agent.continue_wait',
} as const

export type OutboxCommandKind = (typeof OUTBOX_COMMAND_KIND)[keyof typeof OUTBOX_COMMAND_KIND]

export type TaskLifecycleBroadcastCommand = {
  kind: typeof OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST
  version: 1
  eventId: number
  taskId: string
}

export type ProjectAgentContinueWaitCommand = {
  kind: typeof OUTBOX_COMMAND_KIND.PROJECT_AGENT_CONTINUE_WAIT
  version: 1
  waitId: string
  runId: string
  expectedRunVersion: number
  expectedEventSeq: string
}

export type OutboxCommandPayload =
  | TaskLifecycleBroadcastCommand
  | ProjectAgentContinueWaitCommand

export type CreateOutboxCommandInput = {
  idempotencyKey: string
  aggregateType: 'task' | 'project_agent_wait'
  aggregateId: string
  payload: OutboxCommandPayload
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
  const version = readRequiredInteger(record, 'version')
  if (version !== 1) throw new Error(`OUTBOX_COMMAND_VERSION_UNSUPPORTED:${String(version)}`)

  switch (kind) {
    case OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST:
      return {
        kind,
        version,
        eventId: readPositiveInteger(record, 'eventId'),
        taskId: readRequiredString(record, 'taskId'),
      }
    case OUTBOX_COMMAND_KIND.PROJECT_AGENT_CONTINUE_WAIT:
      return {
        kind,
        version,
        waitId: readRequiredString(record, 'waitId'),
        runId: readRequiredString(record, 'runId'),
        expectedRunVersion: readNonNegativeInteger(record, 'expectedRunVersion'),
        expectedEventSeq: readCanonicalBigIntString(record, 'expectedEventSeq'),
      }
    default:
      throw new Error(`OUTBOX_COMMAND_KIND_UNSUPPORTED:${kind}`)
  }
}
