import type { ChatStatus, UIMessage } from 'ai'
import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import type {
  ProjectAgentSessionActivity,
  ProjectAgentSessionPendingInteraction,
} from '@/lib/project-agent/session-state'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import {
  createProjectAgentControlVisibleUserMessageId,
  type ProjectAgentControlAction,
} from '@/lib/project-agent/control'
import type { WorkspaceAssistantActiveFocusRequest } from '../../workspace-assistant-focus'

export type WorkspaceAssistantRunStatus = ProjectAgentRunPartData['status']
export type WorkspaceAssistantControlIntent = 'approve' | 'deny' | 'choice'
export type WorkspaceAssistantControlEndpoint = 'approval' | 'choice'

export function buildWorkspaceAssistantChatId(params: {
  projectId: string
  episodeId?: string
}): string {
  return `workspace-command:${params.projectId}:${params.episodeId || 'global'}`
}

let controlMessageSequence = 0

function createControlNonce(): string {
  controlMessageSequence += 1
  const sequence = controlMessageSequence.toString(36)
  const randomId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${sequence}`
  return `${sequence}-${randomId}`
}

export function createWorkspaceAssistantControlMessageId(params: {
  runId: string
  endpoint: WorkspaceAssistantControlEndpoint
  nonce?: string
}): string {
  const runId = params.runId.trim()
  if (!runId) throw new Error('PROJECT_ASSISTANT_CONTROL_RUN_ID_MISSING')
  const nonce = params.nonce?.trim() || createControlNonce()
  return `workspace-control:${params.endpoint}:${runId}:${nonce}`
}

export function createWorkspaceAssistantControlVisibleUserMessage(params: {
  runId: string
  endpoint: WorkspaceAssistantControlEndpoint
  interruptionId: string
  text: string
}): UIMessage {
  const runId = params.runId.trim()
  if (!runId) throw new Error('PROJECT_ASSISTANT_CONTROL_RUN_ID_MISSING')
  const text = params.text.trim()
  if (!text) throw new Error('PROJECT_ASSISTANT_CONTROL_VISIBLE_USER_TEXT_EMPTY')
  const controlType: ProjectAgentControlAction['type'] = params.endpoint === 'approval'
    ? 'approval_response'
    : 'choice_response'
  return {
    id: createProjectAgentControlVisibleUserMessageId({
      type: controlType,
      runId,
      interruptionId: params.interruptionId,
    }),
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

export function mergeWorkspaceAssistantStreamedMessage(
  currentMessages: readonly UIMessage[],
  message: UIMessage,
): UIMessage[] {
  const messageId = message.id.trim()
  if (!messageId) throw new Error('PROJECT_ASSISTANT_STREAM_MESSAGE_ID_EMPTY')
  const normalizedMessage = messageId === message.id ? message : { ...message, id: messageId }
  const existingIndex = currentMessages.findIndex((item) => item.id === messageId)
  return ensureUniqueUIMessages(existingIndex >= 0
    ? [
        ...currentMessages.slice(0, existingIndex),
        normalizedMessage,
        ...currentMessages.slice(existingIndex + 1),
      ]
    : [...currentMessages, normalizedMessage])
}

export function isWorkspaceAssistantRunBusyStatus(status: WorkspaceAssistantRunStatus): boolean {
  return status === 'running'
}

export function resolveWorkspaceAssistantReplyInFlight(input: {
  requestActive: boolean
  chatTransportActive: boolean
  controlRunActive: boolean
  serverRunActive: boolean
}): boolean {
  return input.requestActive || input.controlRunActive || input.serverRunActive || input.chatTransportActive
}

export function resolveWorkspaceAssistantComposerPending(input: {
  readonly replyInFlight: boolean
  readonly trackedRunStatus: WorkspaceAssistantRunStatus | null
}): boolean {
  return input.replyInFlight || input.trackedRunStatus === 'running'
}

export function canStopWorkspaceAssistantReply(input: {
  chatStatus: ChatStatus
  controlRequestActive: boolean
}): boolean {
  return input.chatStatus === 'submitted' || input.chatStatus === 'streaming' || input.controlRequestActive
}

export function isWorkspaceAssistantOperationPendingStatus(status: WorkspaceAssistantRunStatus): boolean {
  return status === 'running' || status === 'awaiting_task'
}

export function resolveOperationIdFromActivity(activity: ProjectAgentSessionActivity | null): string | null {
  if (!activity || (activity.status !== 'running' && activity.status !== 'waiting')) return null
  if (activity.type === 'task_follow_up' || activity.type === 'awaiting_choice') return null
  return activity.operationId ?? activity.sourceOperationId
}

export function resolveWorkspaceAssistantPendingOperationId(
  trackedRun: {
    operationId: string | null
    intent: WorkspaceAssistantControlIntent | null
    status?: WorkspaceAssistantRunStatus
  } | null,
): string | null {
  if (!trackedRun || trackedRun.intent === 'deny') return null
  if (trackedRun.status && !isWorkspaceAssistantOperationPendingStatus(trackedRun.status)) return null
  return trackedRun.operationId
}

export function resolveWorkspaceAssistantActiveFocusRequest(input: {
  readonly pendingRun: { readonly runId: string } | null
  readonly operationId: string | null
  readonly activities: readonly (ProjectAgentSessionActivity | null)[]
}): WorkspaceAssistantActiveFocusRequest | null {
  if (!input.pendingRun || !input.operationId) return null
  const activity = input.activities.find((candidate) => (
    candidate?.runId === input.pendingRun?.runId
    && resolveOperationIdFromActivity(candidate) === input.operationId
  ))
  return {
    operationId: input.operationId,
    requestKey: activity
      ? `${activity.runId}:${activity.activityId}:${input.operationId}`
      : `${input.pendingRun.runId}:${input.operationId}`,
  }
}

export function resolveWorkspaceAssistantDisplayedPendingInteraction(input: {
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  respondedInterruptionIds: ReadonlySet<string>
}): ProjectAgentSessionPendingInteraction | null {
  if (!input.pendingInteraction) return null
  return input.respondedInterruptionIds.has(input.pendingInteraction.interruptionId)
    ? null
    : input.pendingInteraction
}

export function shouldClearWorkspaceAssistantControlPending(status: WorkspaceAssistantRunStatus): boolean {
  return !isWorkspaceAssistantOperationPendingStatus(status)
}

export function shouldSendWorkspaceAssistantAutomatically(): boolean {
  return false
}
