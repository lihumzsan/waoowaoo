import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceAssistantAwaitingExternalTask,
  resolveWorkspaceAssistantAwaitingUserInput,
  shouldShowWorkspaceAssistantReplyLoading,
} from '@/features/project-workspace/components/WorkspaceAssistantPanel'
import { WorkspaceAssistantPendingTurnPlaceholder } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'
import {
  resolveWorkspaceAssistantReplyInFlight,
} from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime'

describe('workspace assistant reply loading indicator', () => {
  it('shows while the assistant turn is active before transport status flips', () => {
    const replyInFlight = resolveWorkspaceAssistantReplyInFlight({
      requestActive: true,
      chatTransportActive: false,
      controlRunActive: false,
      serverRunActive: false,
    })

    expect(replyInFlight).toBe(true)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)

    const html = renderToStaticMarkup(<WorkspaceAssistantPendingTurnPlaceholder />)
    expect(html).toContain('assistant-thinking-minimal')
    expect(html).toContain('flex flex-col gap-3 px-1 py-1')
  })

  it('keeps the three dots visible after visible text while tools are still running', () => {
    const replyInFlight = resolveWorkspaceAssistantReplyInFlight({
      requestActive: false,
      chatTransportActive: true,
      controlRunActive: false,
      serverRunActive: false,
    })

    expect(replyInFlight).toBe(true)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)
  })

  it('keeps the three dots visible after a request promise settles while the server run is still active', () => {
    const replyInFlight = resolveWorkspaceAssistantReplyInFlight({
      requestActive: false,
      chatTransportActive: false,
      controlRunActive: false,
      serverRunActive: true,
    })

    expect(replyInFlight).toBe(true)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)
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

  it('treats user and external waits as active only after the assistant turn yields control', () => {
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
      activeExternalTaskOperationId: 'ingest_script',
    })).toBe(false)
  })

  it('does not fall back to persisted run markers when session-state is unavailable', () => {
    expect(resolveWorkspaceAssistantReplyInFlight({
      requestActive: false,
      chatTransportActive: false,
      controlRunActive: false,
      serverRunActive: false,
    })).toBe(false)
  })

  it('stops the three dots when session-state reports a terminal run', () => {
    expect(resolveWorkspaceAssistantReplyInFlight({
      requestActive: false,
      chatTransportActive: false,
      controlRunActive: false,
      serverRunActive: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
  })
})
