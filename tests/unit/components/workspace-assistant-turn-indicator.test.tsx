import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceAssistantAwaitingExternalTask,
  resolveWorkspaceAssistantAwaitingUserInput,
  shouldShowWorkspaceAssistantReplyLoading,
} from '@/features/project-workspace/components/WorkspaceAssistantPanel'
import { WorkspaceAssistantPendingTurnPlaceholder } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'

describe('workspace assistant reply loading indicator', () => {
  it('shows from the explicit reply-in-flight state instead of message contents', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)

    const html = renderToStaticMarkup(<WorkspaceAssistantPendingTurnPlaceholder />)
    expect(html).toContain('assistant-thinking-minimal')
    expect(html).toContain('flex flex-col gap-3 px-1 py-1')
  })

  it('does not show while idle, loading storage, waiting for the user, or waiting for an external task', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: true,
      replyInFlight: true,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      awaitingUserInput: true,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      awaitingUserInput: false,
      awaitingExternalTask: true,
    })).toBe(false)
  })

  it('does not let stale user-input waits suppress a just-started control reply', () => {
    expect(resolveWorkspaceAssistantAwaitingUserInput({
      replyInFlight: true,
      hasPendingInteraction: true,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      awaitingUserInput: resolveWorkspaceAssistantAwaitingUserInput({
        replyInFlight: true,
        hasPendingInteraction: true,
      }),
      awaitingExternalTask: false,
    })).toBe(true)
  })

  it('treats user and external waits as active only after the reply has yielded control', () => {
    expect(resolveWorkspaceAssistantAwaitingUserInput({
      replyInFlight: false,
      hasPendingInteraction: true,
    })).toBe(true)
    expect(resolveWorkspaceAssistantAwaitingExternalTask({
      replyInFlight: false,
      currentRunStatus: 'awaiting_task',
      activeExternalTaskOperationId: null,
    })).toBe(true)
    expect(resolveWorkspaceAssistantAwaitingExternalTask({
      replyInFlight: true,
      currentRunStatus: 'awaiting_task',
      activeExternalTaskOperationId: 'generate_edit_screenplay',
    })).toBe(false)
  })
})
