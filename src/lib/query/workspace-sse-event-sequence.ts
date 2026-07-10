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

  private recordEventId(eventId: string): void {
    this.processedEventIds.add(eventId)
    const numericEventId = readNumericWorkspaceSSEEventId(eventId)
    if (numericEventId !== null && numericEventId > this.lastNumericEventId) {
      this.lastNumericEventId = numericEventId
    }
  }

  process(value: unknown, apply: (event: SSEEvent) => void): WorkspaceSSEEventDecision {
    if (!isWorkspaceSSEEvent(value)) return 'invalid'
    if (this.processedEventIds.has(value.id)) return 'duplicate'

    if (isTaskSSEEvent(value) && this.terminalTaskIds.has(value.taskId)) {
      this.recordEventId(value.id)
      return 'rejected_after_terminal'
    }

    apply(value)
    this.recordEventId(value.id)
    if (isTaskSSEEvent(value) && isTerminalTaskEvent(value)) {
      this.terminalTaskIds.add(value.taskId)
    }
    return 'accepted'
  }
}
