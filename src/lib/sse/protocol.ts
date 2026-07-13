import {
  TASK_SSE_EVENT_TYPE,
  WORKSPACE_SSE_EVENT_TYPE,
  type SSEEvent,
} from '@/lib/task/types'

export type WorkspaceSseCursor = {
  taskEventId: number
  mutationEventAtMs: number
  mutationBatchId: string | null
  agentEventId: string
  resourceEventAtMs: number
  resourceOutboxId: string | null
}

export const EMPTY_WORKSPACE_SSE_CURSOR: WorkspaceSseCursor = {
  taskEventId: 0,
  mutationEventAtMs: 0,
  mutationBatchId: null,
  agentEventId: '0',
  resourceEventAtMs: 0,
  resourceOutboxId: null,
}

function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('SSE_CURSOR_INTEGER_INVALID')
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('SSE_CURSOR_INTEGER_INVALID')
  return parsed
}

function parseMutationEventIdentity(value: string): { mutationEventAtMs: number; mutationBatchId: string } | null {
  const match = /^mb:(\d+):(.+)$/.exec(value)
  if (!match) return null
  const mutationEventAtMs = parsePositiveInteger(match[1])
  const mutationBatchId = match[2]
  if (mutationEventAtMs <= 0 || !mutationBatchId) throw new Error('SSE_MUTATION_CURSOR_INVALID')
  return { mutationEventAtMs, mutationBatchId }
}

function parseCanonicalBigInt(value: string): string {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('SSE_CURSOR_BIGINT_INVALID')
  return value
}

function maxCanonicalBigInt(left: string, right: string): string {
  return BigInt(left) >= BigInt(right) ? left : right
}

function parseAgentEventIdentity(value: string): string | null {
  const match = /^agent:(\d+)$/.exec(value)
  return match ? parseCanonicalBigInt(match[1]) : null
}

function parseResourceEventIdentity(value: string): { resourceEventAtMs: number; resourceOutboxId: string } | null {
  const match = /^wr:(\d+):(.+)$/.exec(value)
  if (!match) return null
  const resourceEventAtMs = parsePositiveInteger(match[1])
  const resourceOutboxId = match[2]
  if (resourceEventAtMs <= 0 || !resourceOutboxId) throw new Error('SSE_RESOURCE_CURSOR_INVALID')
  return { resourceEventAtMs, resourceOutboxId }
}

export function parseWorkspaceSseCursor(value: string | null | undefined): WorkspaceSseCursor {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return { ...EMPTY_WORKSPACE_SSE_CURSOR }
  const match = /^v3;t=(\d+);m=(\d+):(.+|-);a=(\d+);r=(\d+):(.+|-)$/.exec(trimmed)
  if (!match) throw new Error('SSE_CURSOR_INVALID')
  const taskEventId = parsePositiveInteger(match[1])
  const mutationEventAtMs = parsePositiveInteger(match[2])
  const encodedBatchId = match[3]
  const mutationBatchId = encodedBatchId === '-' ? null : decodeURIComponent(encodedBatchId)
  if ((mutationEventAtMs === 0) !== (mutationBatchId === null)) {
    throw new Error('SSE_MUTATION_CURSOR_INVALID')
  }
  const resourceEventAtMs = parsePositiveInteger(match[5])
  const encodedResourceOutboxId = match[6]
  const resourceOutboxId = encodedResourceOutboxId === '-' ? null : decodeURIComponent(encodedResourceOutboxId)
  if ((resourceEventAtMs === 0) !== (resourceOutboxId === null)) {
    throw new Error('SSE_RESOURCE_CURSOR_INVALID')
  }
  return {
    taskEventId,
    mutationEventAtMs,
    mutationBatchId,
    agentEventId: parseCanonicalBigInt(match[4]),
    resourceEventAtMs,
    resourceOutboxId,
  }
}

export function serializeWorkspaceSseCursor(cursor: WorkspaceSseCursor): string {
  const normalized = parseWorkspaceSseCursor(
    `v3;t=${String(cursor.taskEventId)};m=${String(cursor.mutationEventAtMs)}:${cursor.mutationBatchId ? encodeURIComponent(cursor.mutationBatchId) : '-'};a=${cursor.agentEventId};r=${String(cursor.resourceEventAtMs)}:${cursor.resourceOutboxId ? encodeURIComponent(cursor.resourceOutboxId) : '-'}`,
  )
  return `v3;t=${String(normalized.taskEventId)};m=${String(normalized.mutationEventAtMs)}:${normalized.mutationBatchId ? encodeURIComponent(normalized.mutationBatchId) : '-'};a=${normalized.agentEventId};r=${String(normalized.resourceEventAtMs)}:${normalized.resourceOutboxId ? encodeURIComponent(normalized.resourceOutboxId) : '-'}`
}

export function advanceWorkspaceSseCursor(cursor: WorkspaceSseCursor, event: SSEEvent): WorkspaceSseCursor {
  const numericTaskEventId = /^\d+$/.test(event.id) ? parsePositiveInteger(event.id) : 0
  const mutation = parseMutationEventIdentity(event.id)
  const agentEventId = parseAgentEventIdentity(event.id)
  const resource = parseResourceEventIdentity(event.id)
  const shouldAdvanceMutation = Boolean(mutation) && (
    mutation!.mutationEventAtMs > cursor.mutationEventAtMs
    || (
      mutation!.mutationEventAtMs === cursor.mutationEventAtMs
      && mutation!.mutationBatchId > (cursor.mutationBatchId ?? '')
    )
  )
  const shouldAdvanceResource = Boolean(resource) && (
    resource!.resourceEventAtMs > cursor.resourceEventAtMs
    || (
      resource!.resourceEventAtMs === cursor.resourceEventAtMs
      && resource!.resourceOutboxId > (cursor.resourceOutboxId ?? '')
    )
  )
  return {
    taskEventId: Math.max(cursor.taskEventId, numericTaskEventId),
    mutationEventAtMs: shouldAdvanceMutation ? mutation!.mutationEventAtMs : cursor.mutationEventAtMs,
    mutationBatchId: shouldAdvanceMutation ? mutation!.mutationBatchId : cursor.mutationBatchId,
    agentEventId: agentEventId
      ? maxCanonicalBigInt(cursor.agentEventId, agentEventId)
      : cursor.agentEventId,
    resourceEventAtMs: shouldAdvanceResource ? resource!.resourceEventAtMs : cursor.resourceEventAtMs,
    resourceOutboxId: shouldAdvanceResource ? resource!.resourceOutboxId : cursor.resourceOutboxId,
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
  if (record.type === WORKSPACE_SSE_EVENT_TYPE.MUTATION_BATCH) {
    return typeof record.mutationBatchId === 'string' && Array.isArray(record.targets)
  }
  if (record.type === WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED) {
    return Array.isArray(record.affectedResources)
  }
  if (record.type === WORKSPACE_SSE_EVENT_TYPE.ASSISTANT_SESSION_CHANGED) {
    return typeof record.assistantId === 'string'
      && record.assistantId.length > 0
      && typeof record.scopeRef === 'string'
      && record.scopeRef.length > 0
      && typeof record.agentEventId === 'string'
      && /^(0|[1-9]\d*)$/.test(record.agentEventId)
      && record.id === `agent:${record.agentEventId}`
      && (typeof record.episodeId === 'string' || record.episodeId === null)
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
  if (!Array.isArray(record.events) || !record.events.every(isWorkspaceSseEvent)) {
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
