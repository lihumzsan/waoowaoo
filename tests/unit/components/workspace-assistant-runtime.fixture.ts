import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceAssistantChatId,
  canStopWorkspaceAssistantReply,
  createWorkspaceAssistantControlMessageId,
  createWorkspaceAssistantControlVisibleUserMessage,
  isWorkspaceAssistantOperationPendingStatus,
  isWorkspaceAssistantRunBusyStatus,
  mergeWorkspaceAssistantStreamedMessage,
  resolveWorkspaceAssistantPendingOperationId,
  shouldClearWorkspaceAssistantControlPending,
  shouldPollWorkspaceAssistantSessionState,
  shouldSendWorkspaceAssistantAutomatically,
} from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime'

import {
  mergeWorkspaceAssistantPersistedMessages,
  shouldRefetchWorkspaceAssistantThreadForRunTransition,
} from '@/features/project-workspace/components/workspace-assistant/thread-sync'

export { describe, expect, it } from 'vitest'
export { buildWorkspaceAssistantChatId, canStopWorkspaceAssistantReply, createWorkspaceAssistantControlMessageId, createWorkspaceAssistantControlVisibleUserMessage, isWorkspaceAssistantOperationPendingStatus, isWorkspaceAssistantRunBusyStatus, mergeWorkspaceAssistantStreamedMessage, resolveWorkspaceAssistantPendingOperationId, shouldClearWorkspaceAssistantControlPending, shouldPollWorkspaceAssistantSessionState, shouldSendWorkspaceAssistantAutomatically } from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime'
export { mergeWorkspaceAssistantPersistedMessages, shouldRefetchWorkspaceAssistantThreadForRunTransition } from '@/features/project-workspace/components/workspace-assistant/thread-sync'
