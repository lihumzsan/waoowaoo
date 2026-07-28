import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import type { ProjectAgentSessionActivity } from '@/lib/project-agent/session-state'
import type {
  ProjectAgentSubagentEventPartData,
  ProjectAgentSubagentStatus,
} from '@/lib/project-agent/subagent-events'

export const WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS = {
} as const

export type WorkspaceAssistantActiveOperationPresentation =
  | (typeof WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS)[keyof typeof WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS]
  | 'genericRun'

export function resolveWorkspaceAssistantActiveOperationPresentation(
  operationId: string | null | undefined,
): WorkspaceAssistantActiveOperationPresentation | null {
  if (!operationId) return null
  return WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS[
    operationId as keyof typeof WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS
  ] ?? 'genericRun'
}

export function shouldShowWorkspaceAssistantExternalTaskRunCard(params: {
  storageLoading: boolean
  operationId: string | null | undefined
}): boolean {
  return !params.storageLoading && Boolean(params.operationId)
}

export function resolveWorkspaceAssistantExternalTaskOperationId(
  currentActivity: ProjectAgentSessionActivity | null,
): string | null {
  if (currentActivity?.type !== 'waiting_task') return null
  if (currentActivity.status !== 'running' && currentActivity.status !== 'waiting') return null
  return currentActivity.operationId ?? currentActivity.sourceOperationId
}

export function shouldShowWorkspaceAssistantReplyLoading(params: {
  storageLoading: boolean
  replyInFlight: boolean
  hasPendingInteraction: boolean
}): boolean {
  return !params.storageLoading
    && params.replyInFlight
    && !params.hasPendingInteraction
}

export function shouldShowWorkspaceAssistantRunFailureNotice(params: {
  storageLoading: boolean
  replyInFlight: boolean
  currentRunStatus?: ProjectAgentRunPartData['status'] | null
}): boolean {
  return !params.storageLoading
    && !params.replyInFlight
    && params.currentRunStatus === 'failed'
}

export function resolveWorkspaceAssistantRunFailureDetail(params: {
  localizedError?: string | null
  fallback: string
}): string {
  return params.localizedError?.trim() || params.fallback
}

export type WorkspaceAssistantSubagentEventGlyph =
  | 'alert'
  | 'check'
  | 'globe'
  | 'loader'
  | 'none'
  | 'tool'

export function resolveWorkspaceAssistantSubagentEventGlyph(params: {
  readonly part: ProjectAgentSubagentEventPartData
  readonly subagentStatus: ProjectAgentSubagentStatus
  readonly isLast: boolean
}): WorkspaceAssistantSubagentEventGlyph {
  const event = params.part.event
  if (
    event.kind === 'tool_failed'
    || event.kind === 'submission_rejected'
    || (event.kind === 'research_completed' && event.status !== 'completed')
  ) {
    return 'alert'
  }

  const isOpen = event.kind === 'tool_called'
    || event.kind === 'research_started'
    || event.kind === 'submission_started'
    || (event.kind === 'generation' && event.status === 'running')
    || (event.kind === 'reasoning' && event.status === 'running')
  if (isOpen && params.isLast) {
    if (params.subagentStatus === 'running') return 'loader'
    if (params.subagentStatus === 'failed' || params.subagentStatus === 'cancelled') {
      return 'alert'
    }
  }

  if (event.kind === 'research_started' || event.kind === 'research_completed') {
    return 'globe'
  }
  if (event.kind === 'submission_accepted') return 'check'
  if (event.kind === 'tool_called' || event.kind === 'tool_completed') {
    return 'tool'
  }
  return 'none'
}
