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
  shouldSendWorkspaceAssistantAutomatically,
} from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime'

import {
  mergeWorkspaceAssistantPersistedMessages,
} from '@/features/project-workspace/components/workspace-assistant/thread-sync'

export { describe, expect, it } from 'vitest'
export { buildWorkspaceAssistantChatId, canStopWorkspaceAssistantReply, createWorkspaceAssistantControlMessageId, createWorkspaceAssistantControlVisibleUserMessage, isWorkspaceAssistantOperationPendingStatus, isWorkspaceAssistantRunBusyStatus, mergeWorkspaceAssistantStreamedMessage, resolveWorkspaceAssistantPendingOperationId, shouldClearWorkspaceAssistantControlPending, shouldSendWorkspaceAssistantAutomatically } from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime'
export { mergeWorkspaceAssistantPersistedMessages } from '@/features/project-workspace/components/workspace-assistant/thread-sync'
