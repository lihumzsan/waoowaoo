import {
  TASK_SSE_EVENT_TYPE,
  WORKSPACE_SSE_EVENT_TYPE,
  isAgentTurnStreamSseEvent,
  type SSEEvent,
} from '@/lib/sse/events'

export type WorkspaceSseCursor = {
  taskEventId: number
}

export const EMPTY_WORKSPACE_SSE_CURSOR: WorkspaceSseCursor = {
  taskEventId: 0,
}

export const WORKSPACE_SSE_CONTROL_EVENT_TYPE = {
  HEARTBEAT: 'heartbeat',
} as const

export const WORKSPACE_SSE_HEARTBEAT_INTERVAL_MS = 15_000
export const WORKSPACE_SSE_HEARTBEAT_TIMEOUT_MS = 45_000

export type WorkspaceSseHeartbeat = {
  readonly ts: string
  readonly workspaceResourceRevision: number | null
}

export function parseWorkspaceSseHeartbeat(value: unknown): WorkspaceSseHeartbeat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SSE_HEARTBEAT_PAYLOAD_INVALID')
  }
  const record = value as Record<string, unknown>
  const revision = record.workspaceResourceRevision
  if (
    typeof record.ts !== 'string'
    || record.ts.length === 0
    || (
      revision !== null
      && (
        typeof revision !== 'number'
        || !Number.isSafeInteger(revision)
        || revision < 0
      )
    )
  ) {
    throw new Error('SSE_HEARTBEAT_PAYLOAD_INVALID')
  }
  return {
    ts: record.ts,
    workspaceResourceRevision: revision as number | null,
  }
}

function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('SSE_CURSOR_INTEGER_INVALID')
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('SSE_CURSOR_INTEGER_INVALID')
  return parsed
}

export function parseWorkspaceSseCursor(value: string | null | undefined): WorkspaceSseCursor {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return { ...EMPTY_WORKSPACE_SSE_CURSOR }
  const match = /^v5;t=(\d+)$/.exec(trimmed)
  if (!match) throw new Error('SSE_CURSOR_INVALID')
  return { taskEventId: parsePositiveInteger(match[1]) }
}

export function serializeWorkspaceSseCursor(cursor: WorkspaceSseCursor): string {
  const normalized = parseWorkspaceSseCursor(`v5;t=${String(cursor.taskEventId)}`)
  return `v5;t=${String(normalized.taskEventId)}`
}

export function advanceWorkspaceSseCursor(cursor: WorkspaceSseCursor, event: SSEEvent): WorkspaceSseCursor {
  const numericTaskEventId = /^\d+$/.test(event.id) ? parsePositiveInteger(event.id) : 0
  return {
    taskEventId: Math.max(cursor.taskEventId, numericTaskEventId),
  }
}

const TASK_SSE_EVENT_TYPES = new Set<string>(Object.values(TASK_SSE_EVENT_TYPE))

function isBaseEvent(record: Record<string, unknown>): boolean {
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.type === 'string'
    && typeof record.projectId === 'string'
    && record.projectId.length > 0
    && typeof record.userId === 'string'
    && record.userId.length > 0
    && typeof record.ts === 'string'
    && record.ts.length > 0
}

export function isWorkspaceSseEvent(value: unknown): value is SSEEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!isBaseEvent(record)) return false
  if (record.type === WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED) {
    return Array.isArray(record.affectedResources)
  }
  if (record.type === WORKSPACE_SSE_EVENT_TYPE.AGENT_SESSION_VIEW_CHANGED) {
    return record.protocol === 'agent_session_view_changed_v1'
      && record.assistantId === 'workspace-command'
      && typeof record.threadId === 'string'
      && record.threadId.length > 0
      && (typeof record.turnId === 'string' || record.turnId === null)
      && (
        record.attempt === null
        || (
          typeof record.attempt === 'number'
          && Number.isSafeInteger(record.attempt)
          && record.attempt > 0
        )
      )
      && typeof record.reason === 'string'
      && record.reason.length > 0
  }
  if (record.type === WORKSPACE_SSE_EVENT_TYPE.AGENT_TURN_STREAM) {
    return record.protocol === 'agent_turn_stream_v1'
      && record.assistantId === 'workspace-command'
      && typeof record.threadId === 'string'
      && record.threadId.length > 0
      && typeof record.turnId === 'string'
      && record.turnId.length > 0
      && typeof record.attempt === 'number'
      && Number.isSafeInteger(record.attempt)
      && record.attempt > 0
      && record.lane === 'ui'
      && typeof record.seq === 'number'
      && Number.isSafeInteger(record.seq)
      && record.seq > 0
      && typeof record.messageId === 'string'
      && record.messageId.length > 0
      && !!record.chunk
      && typeof record.chunk === 'object'
      && !Array.isArray(record.chunk)
  }
  const type = record.type
  return typeof type === 'string'
    && TASK_SSE_EVENT_TYPES.has(type)
    && typeof record.taskId === 'string'
}

export function parseWorkspaceSseEventMessage(message: string): SSEEvent {
  let parsed: unknown
  try {
    parsed = JSON.parse(message) as unknown
  } catch {
    throw new Error('SSE_MESSAGE_JSON_INVALID')
  }
  if (!isWorkspaceSseEvent(parsed)) {
    throw new Error('SSE_MESSAGE_PAYLOAD_INVALID')
  }
  return parsed
}

export type WorkspaceSseBootstrap = {
  channel: string
  mode: string
  events: SSEEvent[]
}

export function parseWorkspaceSseBootstrap(value: unknown): WorkspaceSseBootstrap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SSE_BOOTSTRAP_PAYLOAD_INVALID')
  }
  const record = value as Record<string, unknown>
  if (typeof record.channel !== 'string' || record.channel.length === 0) {
    throw new Error('SSE_BOOTSTRAP_CHANNEL_INVALID')
  }
  if (typeof record.mode !== 'string' || record.mode.length === 0) {
    throw new Error('SSE_BOOTSTRAP_MODE_INVALID')
  }
  if (
    !Array.isArray(record.events)
    || !record.events.every(
      (event) => isWorkspaceSseEvent(event) && !isAgentTurnStreamSseEvent(event),
    )
  ) {
    throw new Error('SSE_BOOTSTRAP_EVENTS_INVALID')
  }
  return {
    channel: record.channel,
    mode: record.mode,
    events: record.events,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SSE_EVENT_IDENTITY_NUMBER_INVALID')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  throw new Error('SSE_EVENT_IDENTITY_VALUE_INVALID')
}

export function getWorkspaceSseEventIdentity(event: SSEEvent): {
  key: string
  fingerprint: string
} {
  return {
    key: `${event.type}:${event.id}`,
    fingerprint: canonicalJson(event),
  }
}
