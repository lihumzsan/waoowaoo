import type { Prisma } from '@prisma/client'
import type { ProjectAgentRunControlKind, ProjectAgentRunStatus } from '../runs'
import type { ProjectAgentWaitFollowUpMode, ProjectAgentWaitTerminalStatus } from '../waits'
import type { ProjectAssistantId } from '../types'
import type { ProjectAgentRunFence } from '../run-fence'

export type ProjectAgentActivityType =
  | 'operation'
  | 'waiting_task'
  | 'task_follow_up'
  | 'awaiting_choice'
  | 'awaiting_approval'

export type ProjectAgentActivityStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ProjectAgentEventScope {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
}

export interface ProjectAgentEventScopeRef {
  projectId: string
  userId: string
  episodeId: string | null
  assistantId: ProjectAssistantId
  scopeRef: string
}

export type ProjectAgentSessionEventPayload = {
  kind: 'thread.cleared'
}

export type ProjectAgentEventPayload =
  | {
    kind: 'run.started'
    runId: string
    requestId: string
    controlKind: ProjectAgentRunControlKind
  }
  | {
    kind: 'run.status_changed'
    runId: string
    status: ProjectAgentRunStatus
    expectedStatuses?: ProjectAgentRunStatus[]
    stopReason?: string | null
    errorCode?: string | null
    errorMessage?: string | null
  }
  | {
    kind: 'run.execution_started'
    runId: string
    executionSegmentId: string
    controlKind: ProjectAgentRunControlKind
  }
  | {
    kind: 'run.completed'
    runId: string
    stopReason?: string | null
  }
  | {
    kind: 'run.failed'
    runId: string
    errorCode: string
    errorMessage: string
    stopReason?: string | null
  }
  | {
    kind: 'run.cancelled'
    runId: string
    reason: string
  }
  | {
    kind: 'activity.started'
    runId: string
    activityId: string
    type: ProjectAgentActivityType
    operationId?: string | null
    sourceOperationId?: string | null
    targetKey?: string | null
    toolCallId?: string | null
  }
  | {
    kind: 'activity.completed'
    runId: string
    activityId: string
  }
  | {
    kind: 'activity.failed'
    runId: string
    activityId: string
    errorCode: string
    errorMessage: string
  }
  | {
    kind: 'activity.cancelled'
    runId: string
    activityId: string
    reason: string
  }
  | {
    kind: 'task.collection_started'
    runId: string
    activityId: string
    waitId: string
    operationId: string
    followUpMode: ProjectAgentWaitFollowUpMode
  }
  | {
    kind: 'task.collection_member_bound'
    runId: string
    activityId: string
    waitId: string
    operationId: string
    memberOperationId: string
    toolCallId: string
    taskIds: string[]
    followUpMode: ProjectAgentWaitFollowUpMode
  }
  | {
    kind: 'task.collection_sealed'
    runId: string
    activityId: string
    waitId: string
    operationId: string
    taskIds: string[]
    followUpMode: ProjectAgentWaitFollowUpMode
  }
  | {
    kind: 'task.progressed'
    runId: string
    activityId: string
    waitId: string
    terminalTaskIds: string[]
    failedTaskIds: string[]
    canceledTaskIds: string[]
  }
  | {
    kind: 'task.terminal'
    runId: string
    activityId: string
    waitId: string
    terminalStatus: ProjectAgentWaitTerminalStatus
    terminalTaskIds: string[]
    failedTaskIds: string[]
    canceledTaskIds: string[]
  }
  | {
    kind: 'wait.followed'
    runId: string
    activityId: string
    waitId: string
    claimId: string
    commandId: string
    sourceOperationId: string
  }
  | {
    kind: 'interruption.raised'
    runId: string
    activityId: string
    interruptionId: string
    interruptionKind: 'approval' | 'choice'
    operationId: string
    approvalId: string
    toolCallId?: string | null
    payload: Prisma.InputJsonValue
    runState?: string | null
  }
  | {
    kind: 'interruption.resolved'
    runId: string
    activityId: string | null
    interruptionId: string
    outcome: 'consumed' | 'superseded'
    response?: Prisma.InputJsonValue | null
  }

export interface ProjectAgentEventInput {
  event: ProjectAgentEventPayload
  runFence: ProjectAgentRunFence
  idempotencyKey?: string | null
}

export type ProjectAgentPersistedEventPayload = ProjectAgentEventPayload & {
  expectedRunVersion: number
  expectedEventSeq: string
}

export interface ProjectAgentActivitySnapshot {
  activityId: string
  runId: string
  type: ProjectAgentActivityType
  status: ProjectAgentActivityStatus
  operationId: string | null
  sourceOperationId: string | null
  toolCallId: string | null
}

export function normalizeProjectAgentActivityType(value: string): ProjectAgentActivityType {
  if (
    value === 'operation'
    || value === 'waiting_task'
    || value === 'task_follow_up'
    || value === 'awaiting_choice'
    || value === 'awaiting_approval'
  ) return value
  throw new Error(`PROJECT_AGENT_ACTIVITY_TYPE_INVALID:${value}`)
}

export function normalizeProjectAgentActivityStatus(value: string): ProjectAgentActivityStatus {
  if (
    value === 'running'
    || value === 'waiting'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
  ) return value
  throw new Error(`PROJECT_AGENT_ACTIVITY_STATUS_INVALID:${value}`)
}

export function isProjectAgentActivityOpenStatus(status: ProjectAgentActivityStatus): boolean {
  return status === 'running' || status === 'waiting'
}
