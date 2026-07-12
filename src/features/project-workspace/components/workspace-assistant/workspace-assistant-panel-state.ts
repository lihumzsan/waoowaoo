import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import type { ProjectAgentSessionActivity } from '@/lib/project-agent/session-state'

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
  awaitingUserInput: boolean
  awaitingExternalTask: boolean
}): boolean {
  return !params.storageLoading
    && params.replyInFlight
    && !params.awaitingUserInput
    && !params.awaitingExternalTask
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

export function resolveWorkspaceAssistantAwaitingUserInput(params: {
  replyInFlight: boolean
  hasPendingInteraction: boolean
}): boolean {
  return !params.replyInFlight && params.hasPendingInteraction
}

export function resolveWorkspaceAssistantAwaitingExternalTask(params: {
  replyInFlight: boolean
  currentRunStatus?: ProjectAgentRunPartData['status'] | null
  activeExternalTaskOperationId?: string | null
}): boolean {
  return !params.replyInFlight && (
    params.currentRunStatus === 'awaiting_task'
      || Boolean(params.activeExternalTaskOperationId)
  )
}
