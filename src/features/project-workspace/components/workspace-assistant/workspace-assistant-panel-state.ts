import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import type { ProjectAgentSessionActivity } from '@/lib/project-agent/session-state'
import type { ChatStatus } from 'ai'

export const WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS = {
  generate_edit_style_preview_images: 'stylePreviewGeneration',
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
  chatStatus: ChatStatus
  awaitingUserInput: boolean
  awaitingExternalTask: boolean
}): boolean {
  return !params.storageLoading
    && params.replyInFlight
    && params.chatStatus === 'submitted'
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
