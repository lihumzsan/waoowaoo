import {
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  WORKSPACE_SSE_EVENT_TYPE,
  type AssistantSessionChangedSSEEvent,
  type SSEEvent,
  type TaskSSEEvent,
} from '@/lib/task/types'
import {
  getWorkspaceSseEventIdentity,
} from '@/lib/sse/protocol'
import {
  isWorkspaceSSEEvent,
  readNumericWorkspaceSSEEventId,
} from './workspace-sse-event-sync'

export type WorkspaceSSEEventDecision =
  | 'accepted'
  | 'duplicate'
  | 'rejected_stale'
  | 'rejected_after_terminal'
  | 'invalid'

export const MAX_TRACKED_SSE_EVENT_IDENTITIES = 2048
export const MAX_TRACKED_SSE_TASK_WATERMARKS = 2048

export class WorkspaceSSESnapshotResyncRequiredError extends Error {
  constructor(reason: 'event_identity_window_overflow' | 'event_identity_conflict' | 'task_watermark_window_overflow') {
    super(`WORKSPACE_SSE_SNAPSHOT_RESYNC_REQUIRED:${reason}`)
    this.name = 'WorkspaceSSESnapshotResyncRequiredError'
  }
}

function isTaskSSEEvent(event: SSEEvent): event is TaskSSEEvent {
  return event.type === TASK_SSE_EVENT_TYPE.LIFECYCLE
    || event.type === TASK_SSE_EVENT_TYPE.STREAM
}

function isTerminalTaskEvent(event: TaskSSEEvent): boolean {
  if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return false
  return event.payload?.lifecycleType === TASK_EVENT_TYPE.COMPLETED
    || event.payload?.lifecycleType === TASK_EVENT_TYPE.FAILED
    || event.payload?.lifecycleType === TASK_EVENT_TYPE.CANCELED
}

function readNumericEventId(event: SSEEvent): number | null {
  return readNumericWorkspaceSSEEventId(event.id)
}

/**
 * The single per-connection ordering authority for workspace SSE events.
 * Query Cache and Canvas runtime only observe events accepted here.
 */
export class WorkspaceSSEEventSequence {
  private readonly processedEventFingerprints = new Map<string, string>()
  private readonly taskWatermarks = new Map<string, { eventId: number; terminal: boolean }>()
  private readonly initialTaskEventId: number
  private lastNumericEventId: number
  private lastAgentEventId: bigint

  constructor(
    initialTaskEventId = 0,
    private readonly limits: {
      eventIdentities?: number
      taskWatermarks?: number
    } = {},
    initialAgentEventId = '0',
  ) {
    if (!Number.isSafeInteger(initialTaskEventId) || initialTaskEventId < 0) {
      throw new Error('WORKSPACE_SSE_INITIAL_CURSOR_INVALID')
    }
    if (!/^(0|[1-9]\d*)$/.test(initialAgentEventId)) {
      throw new Error('WORKSPACE_SSE_INITIAL_AGENT_CURSOR_INVALID')
    }
    this.initialTaskEventId = initialTaskEventId
    this.lastNumericEventId = initialTaskEventId
    this.lastAgentEventId = BigInt(initialAgentEventId)
  }

  getLastAgentEventId(): string {
    return this.lastAgentEventId.toString()
  }

  getLastNumericEventId(): number {
    return this.lastNumericEventId
  }

  private recordEventIdentity(eventIdentity: string, fingerprint: string, eventId: string): void {
    if (!this.processedEventFingerprints.has(eventIdentity)) {
      const limit = this.limits.eventIdentities ?? MAX_TRACKED_SSE_EVENT_IDENTITIES
      if (this.processedEventFingerprints.size >= limit) {
        throw new WorkspaceSSESnapshotResyncRequiredError('event_identity_window_overflow')
      }
      this.processedEventFingerprints.set(eventIdentity, fingerprint)
    }
    const numericEventId = readNumericWorkspaceSSEEventId(eventId)
    this.lastNumericEventId = Math.max(this.lastNumericEventId, numericEventId ?? 0)
  }

  private assertCapacity(eventIdentity: string, event: SSEEvent): void {
    const identityLimit = this.limits.eventIdentities ?? MAX_TRACKED_SSE_EVENT_IDENTITIES
    if (!this.processedEventFingerprints.has(eventIdentity) && this.processedEventFingerprints.size >= identityLimit) {
      throw new WorkspaceSSESnapshotResyncRequiredError('event_identity_window_overflow')
    }
    if (isTaskSSEEvent(event) && !this.taskWatermarks.has(event.taskId)) {
      const taskLimit = this.limits.taskWatermarks ?? MAX_TRACKED_SSE_TASK_WATERMARKS
      if (this.taskWatermarks.size >= taskLimit) {
        throw new WorkspaceSSESnapshotResyncRequiredError('task_watermark_window_overflow')
      }
    }
  }

  private taskDecision(event: TaskSSEEvent): WorkspaceSSEEventDecision | null {
    const numericEventId = readNumericEventId(event)
    const current = this.taskWatermarks.get(event.taskId)
    if (current?.terminal) return 'rejected_after_terminal'
    if (numericEventId !== null) {
      if (numericEventId <= (current?.eventId ?? 0)) return 'rejected_stale'
      if (!current && numericEventId <= this.initialTaskEventId) return 'rejected_stale'
    }
    return null
  }

  private recordTaskWatermark(event: TaskSSEEvent): void {
    const numericEventId = readNumericEventId(event)
    const current = this.taskWatermarks.get(event.taskId)
    if (!current) {
      const limit = this.limits.taskWatermarks ?? MAX_TRACKED_SSE_TASK_WATERMARKS
      if (this.taskWatermarks.size >= limit) {
        throw new WorkspaceSSESnapshotResyncRequiredError('task_watermark_window_overflow')
      }
    }
    this.taskWatermarks.set(event.taskId, {
      eventId: Math.max(current?.eventId ?? 0, numericEventId ?? 0),
      terminal: current?.terminal === true || isTerminalTaskEvent(event),
    })
  }

  private assistantDecision(event: AssistantSessionChangedSSEEvent): WorkspaceSSEEventDecision | null {
    return BigInt(event.agentEventId) <= this.lastAgentEventId ? 'rejected_stale' : null
  }

  process(value: unknown, apply: (event: SSEEvent) => void): WorkspaceSSEEventDecision {
    if (!isWorkspaceSSEEvent(value)) return 'invalid'
    const identity = getWorkspaceSseEventIdentity(value)
    const existingFingerprint = this.processedEventFingerprints.get(identity.key)
    if (existingFingerprint === identity.fingerprint) return 'duplicate'
    if (existingFingerprint !== undefined) {
      throw new WorkspaceSSESnapshotResyncRequiredError('event_identity_conflict')
    }
    this.assertCapacity(identity.key, value)

    const taskDecision = isTaskSSEEvent(value) ? this.taskDecision(value) : null
    const assistantDecision = value.type === WORKSPACE_SSE_EVENT_TYPE.ASSISTANT_SESSION_CHANGED
      ? this.assistantDecision(value)
      : null
    const rejection = taskDecision ?? assistantDecision
    if (rejection) {
      this.recordEventIdentity(identity.key, identity.fingerprint, value.id)
      return rejection
    }

    apply(value)
    this.recordEventIdentity(identity.key, identity.fingerprint, value.id)
    if (isTaskSSEEvent(value)) this.recordTaskWatermark(value)
    if (value.type === WORKSPACE_SSE_EVENT_TYPE.ASSISTANT_SESSION_CHANGED) {
      this.lastAgentEventId = BigInt(value.agentEventId)
    }
    return 'accepted'
  }
}
