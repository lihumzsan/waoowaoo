import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceAssistantAwaitingExternalTask,
  resolveWorkspaceAssistantAwaitingUserInput,
  shouldShowWorkspaceAssistantReplyLoading,
} from '@/features/project-workspace/components/WorkspaceAssistantPanel'
import { WorkspaceAssistantPendingTurnPlaceholder } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'
import {
  findLatestWorkspaceAssistantRunAtOrAfterMessageIndex,
  resolveWorkspaceAssistantReplyInFlight,
} from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime'

describe('workspace assistant reply loading indicator', () => {
  it('shows while the assistant turn is active before transport status flips', () => {
    const replyInFlight = resolveWorkspaceAssistantReplyInFlight({
      requestActive: true,
      chatTransportActive: false,
      controlRunActive: false,
      serverRunActive: false,
      streamedRunStatus: null,
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
      streamedRunStatus: 'running',
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
      streamedRunStatus: 'running',
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
      activeExternalTaskOperationId: 'generate_edit_screenplay',
    })).toBe(false)
  })

  it('stops the three dots when the streamed run yields control or completes', () => {
    expect(resolveWorkspaceAssistantReplyInFlight({
      requestActive: false,
      chatTransportActive: true,
      controlRunActive: false,
      serverRunActive: false,
      streamedRunStatus: 'awaiting_choice',
    })).toBe(false)
    expect(resolveWorkspaceAssistantReplyInFlight({
      requestActive: false,
      chatTransportActive: true,
      controlRunActive: false,
      serverRunActive: false,
      streamedRunStatus: 'awaiting_task',
    })).toBe(false)
    expect(resolveWorkspaceAssistantReplyInFlight({
      requestActive: false,
      chatTransportActive: true,
      controlRunActive: false,
      serverRunActive: false,
      streamedRunStatus: 'completed',
    })).toBe(false)
  })

  it('treats the current streamed run stop status as authoritative over stale active signals', () => {
    expect(resolveWorkspaceAssistantReplyInFlight({
      requestActive: true,
      chatTransportActive: true,
      controlRunActive: true,
      serverRunActive: true,
      streamedRunStatus: 'awaiting_task',
    })).toBe(false)

    expect(resolveWorkspaceAssistantReplyInFlight({
      requestActive: true,
      chatTransportActive: true,
      controlRunActive: true,
      serverRunActive: true,
      streamedRunStatus: 'completed',
    })).toBe(false)
  })

  it('ignores run states that belong to messages before the active turn boundary', () => {
    const previousTurnMessages: UIMessage[] = [
      {
        id: 'assistant-old',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-run',
            data: {
              runId: 'run-old',
              status: 'completed',
            },
          } as never,
        ],
      },
      {
        id: 'user-new',
        role: 'user',
        parts: [{ type: 'text', text: '继续' }],
      },
    ]

    expect(findLatestWorkspaceAssistantRunAtOrAfterMessageIndex(previousTurnMessages, 1)).toBeNull()

    const activeTurnMessages: UIMessage[] = [
      ...previousTurnMessages,
      {
        id: 'assistant-new',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-run',
            data: {
              runId: 'run-new',
              status: 'running',
            },
          } as never,
        ],
      },
    ]

    expect(findLatestWorkspaceAssistantRunAtOrAfterMessageIndex(activeTurnMessages, 1)?.status).toBe('running')
  })
})
