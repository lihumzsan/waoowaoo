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
  hasWorkspaceAssistantVisibleOutput,
  hasWorkspaceAssistantVisibleOutputAtOrAfterMessageIndex,
} from '@/features/project-workspace/components/workspace-assistant/visible-output'

describe('workspace assistant reply loading indicator', () => {
  it('shows only while the active reply is awaiting its first visible output', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      replyAwaitingFirstVisibleOutput: true,
      hasVisibleActivityIndicator: false,
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
      replyAwaitingFirstVisibleOutput: true,
      hasVisibleActivityIndicator: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: true,
      replyInFlight: true,
      replyAwaitingFirstVisibleOutput: true,
      hasVisibleActivityIndicator: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      replyAwaitingFirstVisibleOutput: false,
      hasVisibleActivityIndicator: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      replyAwaitingFirstVisibleOutput: true,
      hasVisibleActivityIndicator: true,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      replyAwaitingFirstVisibleOutput: true,
      hasVisibleActivityIndicator: false,
      awaitingUserInput: true,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      replyAwaitingFirstVisibleOutput: true,
      hasVisibleActivityIndicator: false,
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
      replyAwaitingFirstVisibleOutput: true,
      hasVisibleActivityIndicator: false,
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

  it('keeps the control reply placeholder visible while only prior choice-card output exists', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      replyAwaitingFirstVisibleOutput: true,
      hasVisibleActivityIndicator: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)
  })

  it('detects visible output from the real streamed message even when the stream replaces the local id', () => {
    const realStreamMessage: UIMessage = {
      id: 'server-replaced-message-id',
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
    }

    expect(hasWorkspaceAssistantVisibleOutput(realStreamMessage)).toBe(true)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      replyAwaitingFirstVisibleOutput: false,
      hasVisibleActivityIndicator: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
  })

  it('hides the reply placeholder when a visible tool row has started without text', () => {
    expect(hasWorkspaceAssistantVisibleOutput({
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'generate_edit_screenplay',
          state: 'input-available',
        } as never,
      ],
    })).toBe(true)
  })

  it('treats operation activity as visible output because it renders the active run card', () => {
    expect(hasWorkspaceAssistantVisibleOutput({
      id: 'assistant-activity',
      role: 'assistant',
      parts: [
        {
          type: 'data-agent-activity',
          data: {
            activityId: 'activity-1',
            runId: 'run-1',
            type: 'operation',
            status: 'running',
            operationId: 'generate_edit_screenplay',
            sourceOperationId: null,
            toolCallId: null,
            choiceType: null,
          },
        } as never,
      ],
    })).toBe(true)
  })

  it('detects normal chat visible output after the reply wait boundary', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-old',
        role: 'assistant',
        parts: [{ type: 'text', text: '旧选择卡说明' }],
      },
      {
        id: 'user-new',
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
            type: 'text',
            text: '正在生成。',
          },
        ],
      },
    ]

    expect(hasWorkspaceAssistantVisibleOutputAtOrAfterMessageIndex(messages, 2)).toBe(true)
  })

  it('ignores visible output that existed before the current reply wait began', () => {
    const waitingMessages: UIMessage[] = [
      {
        id: 'assistant-old',
        role: 'assistant',
        parts: [{ type: 'text', text: '上一轮已经显示的文本' }],
      },
      {
        id: 'user-new',
        role: 'user',
        parts: [{ type: 'text', text: '继续' }],
      },
    ]
    const messages: UIMessage[] = [
      ...waitingMessages,
      {
        id: 'assistant-new',
        role: 'assistant',
        parts: [{ type: 'text', text: '这一轮的新文本' }],
      },
    ]

    expect(hasWorkspaceAssistantVisibleOutputAtOrAfterMessageIndex(waitingMessages, 1)).toBe(false)
    expect(hasWorkspaceAssistantVisibleOutputAtOrAfterMessageIndex(messages, 1)).toBe(true)
  })

  it('does not treat hidden runtime markers as visible reply output', () => {
    expect(hasWorkspaceAssistantVisibleOutput({
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
    })).toBe(false)
  })
})
