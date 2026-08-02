import type { UIMessageChunk } from 'ai'
import type {
  TaskLifecycleEventType,
  WorkspaceResourceRef,
} from '@/lib/task/types'

export const TASK_SSE_EVENT_TYPE = {
  LIFECYCLE: 'task.lifecycle',
  STREAM: 'task.stream',
} as const

export const WORKSPACE_SSE_EVENT_TYPE = {
  RESOURCE_CHANGED: 'resource.changed',
  AGENT_SESSION_VIEW_CHANGED: 'assistant.view.changed',
  AGENT_TURN_STREAM: 'agent.turn.stream',
} as const

export type TaskSSEEventType =
  (typeof TASK_SSE_EVENT_TYPE)[keyof typeof TASK_SSE_EVENT_TYPE]

export interface TaskSSEEvent {
  id: string
  type: TaskSSEEventType
  taskId: string
  projectId: string
  userId: string
  ts: string
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  payload?: (Record<string, unknown> & {
    lifecycleType?: TaskLifecycleEventType
    coveredTargets?: readonly {
      readonly targetType: string
      readonly targetId: string
    }[]
    affectedResources?: readonly WorkspaceResourceRef[]
  }) | null
}

export interface ResourceChangedSSEEvent {
  id: string
  type: typeof WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED
  projectId: string
  userId: string
  ts: string
  affectedResources: WorkspaceResourceRef[]
}

export interface AgentSessionViewChangedSSEEvent {
  protocol: 'agent_session_view_changed_v1'
  id: string
  type: typeof WORKSPACE_SSE_EVENT_TYPE.AGENT_SESSION_VIEW_CHANGED
  projectId: string
  userId: string
  assistantId: 'workspace-command'
  threadId: string
  turnId: string | null
  attempt: number | null
  reason: string
  ts: string
}

export interface AgentTurnStreamSSEEvent {
  protocol: 'agent_turn_stream_v1'
  id: string
  type: typeof WORKSPACE_SSE_EVENT_TYPE.AGENT_TURN_STREAM
  projectId: string
  userId: string
  assistantId: 'workspace-command'
  threadId: string
  turnId: string
  attempt: number
  lane: 'ui'
  seq: number
  messageId: string
  chunk: UIMessageChunk
  ts: string
}

export type SSEEvent =
  | TaskSSEEvent
  | ResourceChangedSSEEvent
  | AgentSessionViewChangedSSEEvent
  | AgentTurnStreamSSEEvent

export function isAgentTurnStreamSseEvent(
  event: SSEEvent,
): event is AgentTurnStreamSSEEvent {
  return event.type === WORKSPACE_SSE_EVENT_TYPE.AGENT_TURN_STREAM
}

export function isTaskSseEvent(event: SSEEvent): event is TaskSSEEvent {
  return event.type === TASK_SSE_EVENT_TYPE.LIFECYCLE
    || event.type === TASK_SSE_EVENT_TYPE.STREAM
}

export function isAgentScopedSseEvent(
  event: SSEEvent,
): event is
  | AgentSessionViewChangedSSEEvent
  | AgentTurnStreamSSEEvent {
  return (
    event.type === WORKSPACE_SSE_EVENT_TYPE.AGENT_SESSION_VIEW_CHANGED
    || event.type === WORKSPACE_SSE_EVENT_TYPE.AGENT_TURN_STREAM
  )
}
