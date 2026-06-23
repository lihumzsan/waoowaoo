import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  hasWorkspaceAssistantVisibleReplyOutput,
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
      hasVisibleReplyOutput: false,
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
      hasVisibleReplyOutput: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: true,
      replyInFlight: true,
      hasVisibleReplyOutput: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      hasVisibleReplyOutput: true,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      hasVisibleReplyOutput: false,
      awaitingUserInput: true,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      hasVisibleReplyOutput: false,
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
      hasVisibleReplyOutput: false,
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

  it('keeps the control reply placeholder visible until the active control message has output', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-original',
        role: 'user',
        parts: [{ type: 'text', text: '恐怖片' }],
      },
      {
        id: 'assistant-choice-card',
        role: 'assistant',
        parts: [
          { type: 'text', text: '请选择剧本方向' },
          {
            type: 'data-assistant-choice-card',
            data: {
              runId: 'run-1',
              interruptionId: 'choice-1',
              choiceType: 'screenplay_review',
            },
          } as never,
        ],
      },
    ]

    const hasVisibleOutput = hasWorkspaceAssistantVisibleReplyOutput({
      messages,
      activeReplyMessageId: 'workspace-control:choice:run-1:reply-1',
      controlPending: true,
    })

    expect(hasVisibleOutput).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      hasVisibleReplyOutput: hasVisibleOutput,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)
  })

  it('hides the control reply placeholder when the active control message starts rendering text', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-original',
        role: 'user',
        parts: [{ type: 'text', text: '恐怖片' }],
      },
      {
        id: 'assistant-choice-card',
        role: 'assistant',
        parts: [{ type: 'text', text: '请选择剧本方向' }],
      },
      {
        id: 'workspace-control:choice:run-1:reply-1',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-run',
            data: {
              runId: 'run-1',
              requestId: 'request-1',
              status: 'running',
              controlKind: 'choice_response',
            },
          } as never,
          { type: 'text', text: '我会把它改成恐怖故事。' },
        ],
      },
    ]

    const hasVisibleOutput = hasWorkspaceAssistantVisibleReplyOutput({
      messages,
      activeReplyMessageId: 'workspace-control:choice:run-1:reply-1',
      controlPending: true,
    })

    expect(hasVisibleOutput).toBe(true)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      hasVisibleReplyOutput: hasVisibleOutput,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
  })

  it('hides the reply placeholder when a visible tool row has started without text', () => {
    expect(hasWorkspaceAssistantVisibleReplyOutput({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: '生成剧本' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'generate_edit_screenplay',
              state: 'input-available',
            } as never,
          ],
        },
      ],
      activeReplyMessageId: null,
      controlPending: false,
    })).toBe(true)
  })

  it('does not treat hidden runtime markers as visible reply output', () => {
    expect(hasWorkspaceAssistantVisibleReplyOutput({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: '生成剧本' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            {
              type: 'data-agent-run',
              data: {
                runId: 'run-1',
                requestId: 'request-1',
                status: 'running',
                controlKind: 'user_turn',
              },
            } as never,
            {
              type: 'data-agent-operation-start',
              data: {
                runId: 'run-1',
                operationId: 'generate_edit_screenplay',
              },
            } as never,
          ],
        },
      ],
      activeReplyMessageId: null,
      controlPending: false,
    })).toBe(false)
  })
})
