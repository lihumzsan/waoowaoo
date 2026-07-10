import {
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  type SSEEvent,
  type TaskSSEEvent,
} from '@/lib/task/types'
import {
  isWorkspaceSSEEvent,
  readNumericWorkspaceSSEEventId,
} from './workspace-sse-event-sync'

export type WorkspaceSSEEventDecision =
  | 'accepted'
  | 'duplicate'
  | 'rejected_after_terminal'
  | 'invalid'

const MAX_TRACKED_EVENT_IDENTITIES = 2048
const MAX_TRACKED_TERMINAL_TASKS = 2048

function addBoundedIdentity(identities: Set<string>, identity: string, limit: number): void {
  identities.delete(identity)
  identities.add(identity)
  while (identities.size > limit) {
    const oldest = identities.values().next().value as string
    identities.delete(oldest)
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
}

/**
 * The single per-connection ordering authority for workspace SSE events.
 * Query Cache and Canvas runtime only observe events accepted here.
 */
export class WorkspaceSSEEventSequence {
  private readonly processedEventIds = new Set<string>()
  private readonly terminalTaskIds = new Set<string>()
  private lastNumericEventId = 0

  getLastNumericEventId(): number {
    return this.lastNumericEventId
  }

  private recordEventId(eventIdentity: string, eventId: string): void {
    addBoundedIdentity(this.processedEventIds, eventIdentity, MAX_TRACKED_EVENT_IDENTITIES)
    const numericEventId = readNumericWorkspaceSSEEventId(eventId)
    this.lastNumericEventId = Math.max(this.lastNumericEventId, numericEventId ?? 0)
  }

  process(value: unknown, apply: (event: SSEEvent) => void): WorkspaceSSEEventDecision {
    if (!isWorkspaceSSEEvent(value)) return 'invalid'
    const eventIdentity = `${value.type}:${value.id}`
    if (this.processedEventIds.has(eventIdentity)) return 'duplicate'

    if (isTaskSSEEvent(value) && this.terminalTaskIds.has(value.taskId)) {
      this.recordEventId(eventIdentity, value.id)
      return 'rejected_after_terminal'
    }

    apply(value)
    this.recordEventId(eventIdentity, value.id)
    if (isTaskSSEEvent(value) && isTerminalTaskEvent(value)) {
      addBoundedIdentity(this.terminalTaskIds, value.taskId, MAX_TRACKED_TERMINAL_TASKS)
    }
    return 'accepted'
  }
}
