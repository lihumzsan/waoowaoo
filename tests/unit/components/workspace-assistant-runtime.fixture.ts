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
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-runtime-state'

import {
  mergeWorkspaceAssistantPersistedMessages,
  resolveWorkspaceAssistantThreadSnapshotMessages,
} from '@/features/project-workspace/components/workspace-assistant/thread-sync'

export { describe, expect, it } from 'vitest'
export { buildWorkspaceAssistantChatId, canStopWorkspaceAssistantReply, createWorkspaceAssistantControlMessageId, createWorkspaceAssistantControlVisibleUserMessage, isWorkspaceAssistantOperationPendingStatus, isWorkspaceAssistantRunBusyStatus, mergeWorkspaceAssistantStreamedMessage, resolveWorkspaceAssistantPendingOperationId, shouldClearWorkspaceAssistantControlPending, shouldSendWorkspaceAssistantAutomatically } from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-runtime-state'
export { mergeWorkspaceAssistantPersistedMessages } from '@/features/project-workspace/components/workspace-assistant/thread-sync'
export { resolveWorkspaceAssistantThreadSnapshotMessages } from '@/features/project-workspace/components/workspace-assistant/thread-sync'
