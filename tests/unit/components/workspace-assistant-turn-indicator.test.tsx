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
  hasWorkspaceAssistantReplyLoadingStop,
  hasWorkspaceAssistantReplyLoadingStopAtOrAfterMessageIndex,
  hasWorkspaceAssistantTextOutput,
} from '@/features/project-workspace/components/workspace-assistant/visible-output'

describe('workspace assistant reply loading indicator', () => {
  it('shows while the active reply is awaiting its first text output', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyAwaitingFirstTextOutput: true,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)

    const html = renderToStaticMarkup(<WorkspaceAssistantPendingTurnPlaceholder />)
    expect(html).toContain('assistant-thinking-minimal')
    expect(html).toContain('flex flex-col gap-3 px-1 py-1')
  })

  it('does not require the transport status to flip before showing the initial reply placeholder', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyAwaitingFirstTextOutput: true,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)
  })

  it('does not show while idle, loading storage, waiting for the user, or waiting for an external task', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyAwaitingFirstTextOutput: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: true,
      replyAwaitingFirstTextOutput: true,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyAwaitingFirstTextOutput: true,
      awaitingUserInput: true,
      awaitingExternalTask: false,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyAwaitingFirstTextOutput: true,
      awaitingUserInput: false,
      awaitingExternalTask: true,
    })).toBe(false)
  })

  it('keeps thinking visible during tool use, activity cards, and data cards before text output', () => {
    const nonTextMessages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: '读取上下文' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'get_project_context',
            toolCallId: 'call-1',
            state: 'input-available',
            input: {},
          } as never,
          {
            type: 'data-agent-activity',
            data: {
              activityId: 'activity-1',
              runId: 'run-1',
              type: 'operation',
              status: 'running',
              operationId: 'get_project_context',
              sourceOperationId: null,
              toolCallId: 'call-1',
              choiceType: null,
            },
          } as never,
          {
            type: 'data-project-context',
            data: {
              context: {},
            },
          } as never,
        ],
      },
    ]

    expect(hasWorkspaceAssistantReplyLoadingStopAtOrAfterMessageIndex(nonTextMessages, 1)).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyAwaitingFirstTextOutput: true,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(true)
  })

  it('does not let stale user-input waits suppress a just-started control reply', () => {
    expect(resolveWorkspaceAssistantAwaitingUserInput({
      replyInFlight: true,
      hasPendingInteraction: true,
    })).toBe(false)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyAwaitingFirstTextOutput: true,
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

  it('detects text output from the real streamed message even when the stream replaces the local id', () => {
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

    expect(hasWorkspaceAssistantTextOutput(realStreamMessage)).toBe(true)
    expect(hasWorkspaceAssistantReplyLoadingStop(realStreamMessage)).toBe(true)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyAwaitingFirstTextOutput: false,
      awaitingUserInput: false,
      awaitingExternalTask: false,
    })).toBe(false)
  })

  it('detects normal chat text output after the reply wait boundary', () => {
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

    expect(hasWorkspaceAssistantReplyLoadingStopAtOrAfterMessageIndex(messages, 2)).toBe(true)
  })

  it('stops thinking when the agent yields control to user input or external tasks', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-choice',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-activity',
            data: {
              activityId: 'activity-choice',
              runId: 'run-1',
              type: 'awaiting_choice',
              status: 'waiting',
              operationId: null,
              sourceOperationId: 'request_edit_screenplay_review_choice',
              toolCallId: null,
              choiceType: 'screenplay_review',
            },
          } as never,
        ],
      },
      {
        id: 'assistant-approval',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-activity',
            data: {
              activityId: 'activity-approval',
              runId: 'run-1',
              type: 'awaiting_approval',
              status: 'waiting',
              operationId: 'generate_edit_screenplay',
              sourceOperationId: null,
              toolCallId: 'call-1',
              choiceType: null,
            },
          } as never,
        ],
      },
      {
        id: 'assistant-wait',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-activity',
            data: {
              activityId: 'activity-wait',
              runId: 'run-1',
              type: 'waiting_task',
              status: 'waiting',
              operationId: null,
              sourceOperationId: 'generate_edit_screenplay',
              toolCallId: null,
              choiceType: null,
            },
          } as never,
        ],
      },
    ]

    expect(messages.every((message) => hasWorkspaceAssistantReplyLoadingStop(message))).toBe(true)
  })

  it('ignores text output that existed before the current reply wait began', () => {
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

    expect(hasWorkspaceAssistantReplyLoadingStopAtOrAfterMessageIndex(waitingMessages, 1)).toBe(false)
    expect(hasWorkspaceAssistantReplyLoadingStopAtOrAfterMessageIndex(messages, 1)).toBe(true)
  })

  it('does not treat hidden runtime markers as text output', () => {
    expect(hasWorkspaceAssistantTextOutput({
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
