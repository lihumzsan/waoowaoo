import {
  TASK_SSE_EVENT_TYPE,
  isAgentTurnStreamSseEvent,
  isTaskSseEvent,
  type SSEEvent,
  type TaskSSEEvent,
} from '@/lib/sse/events'
import { isTaskTerminalEventType } from '@/lib/task/types'
import {
  getWorkspaceSseEventIdentity,
  isWorkspaceSseEvent,
} from '@/lib/sse/protocol'
import {
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

function isTerminalTaskEvent(event: TaskSSEEvent): boolean {
  if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return false
  return isTaskTerminalEventType(event.payload?.lifecycleType)
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

  constructor(
    initialTaskEventId = 0,
    private readonly limits: {
      eventIdentities?: number
      taskWatermarks?: number
    } = {},
  ) {
    if (!Number.isSafeInteger(initialTaskEventId) || initialTaskEventId < 0) {
      throw new Error('WORKSPACE_SSE_INITIAL_CURSOR_INVALID')
    }
    this.initialTaskEventId = initialTaskEventId
    this.lastNumericEventId = initialTaskEventId
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
    if (isTaskSseEvent(event) && !this.taskWatermarks.has(event.taskId)) {
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

  process(value: unknown, apply: (event: SSEEvent) => void): WorkspaceSSEEventDecision {
    if (!isWorkspaceSseEvent(value)) return 'invalid'
    if (isAgentTurnStreamSseEvent(value)) {
      apply(value)
      return 'accepted'
    }
    const identity = getWorkspaceSseEventIdentity(value)
    const existingFingerprint = this.processedEventFingerprints.get(identity.key)
    if (existingFingerprint === identity.fingerprint) return 'duplicate'
    if (existingFingerprint !== undefined) {
      throw new WorkspaceSSESnapshotResyncRequiredError('event_identity_conflict')
    }
    this.assertCapacity(identity.key, value)

    const taskDecision = isTaskSseEvent(value) ? this.taskDecision(value) : null
    const rejection = taskDecision
    if (rejection) {
      this.recordEventIdentity(identity.key, identity.fingerprint, value.id)
      return rejection
    }

    apply(value)
    this.recordEventIdentity(identity.key, identity.fingerprint, value.id)
    if (isTaskSseEvent(value)) this.recordTaskWatermark(value)
    return 'accepted'
  }
}
