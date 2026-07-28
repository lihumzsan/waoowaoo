import { describe, expect, it } from 'vitest'
import {
  shouldShowWorkspaceAssistantReplyLoading,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-panel-state'
import {
  resolveWorkspaceAssistantComposerPending,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-runtime-state'

describe('Workspace Assistant foreground and background presentation', () => {
  it('keeps the composer available for an awaiting background Task', () => {
    expect(resolveWorkspaceAssistantComposerPending({
      replyInFlight: false,
      trackedRunStatus: 'awaiting_task',
    })).toBe(false)
  })

  it('disables the composer while a foreground reply is actually running', () => {
    expect(resolveWorkspaceAssistantComposerPending({
      replyInFlight: true,
      trackedRunStatus: 'running',
    })).toBe(true)
  })

  it('shows a pending reply when a server continuation runs without a chat transport', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      chatStatus: 'ready',
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)
  })

  it('does not duplicate the placeholder once response content is streaming', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      chatStatus: 'streaming',
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
  })
})
