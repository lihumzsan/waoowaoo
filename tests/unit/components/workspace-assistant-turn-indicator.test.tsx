import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  findLatestAssistantMessageIdAfterLatestUser,
  hasWorkspaceAssistantPendingActivityAfterLatestUser,
  hasWorkspaceAssistantVisibleTextAfterLatestUser,
  resolveWorkspaceAssistantActiveThinkingMessageId,
  shouldShowPendingAssistantTurnPlaceholder,
  WorkspaceAssistantPendingTurnPlaceholder,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'

function message(id: string, role: UIMessage['role']): Pick<UIMessage, 'id' | 'role'> {
  return { id, role }
}

function turnMessage(
  id: string,
  role: UIMessage['role'],
  parts: UIMessage['parts'],
): Pick<UIMessage, 'id' | 'role' | 'parts'> {
  return { id, role, parts }
}

describe('workspace assistant turn indicator', () => {
  it('anchors thinking to the assistant message after the latest user turn', () => {
    const messages: readonly Pick<UIMessage, 'id' | 'role'>[] = [
      message('user-1', 'user'),
      message('assistant-1-with-tools', 'assistant'),
      message('user-2', 'user'),
      message('assistant-2-with-tools', 'assistant'),
      message('user-3-current', 'user'),
      message('assistant-3-current', 'assistant'),
    ]

    expect(findLatestAssistantMessageIdAfterLatestUser(messages)).toBe('assistant-3-current')
  })

  it('does not attach a streaming indicator to historical assistant tool calls before the latest user turn', () => {
    const messages: readonly Pick<UIMessage, 'id' | 'role'>[] = [
      message('user-1', 'user'),
      message('assistant-1-with-tools', 'assistant'),
      message('user-2-current', 'user'),
    ]

    const activeAssistantMessageId = findLatestAssistantMessageIdAfterLatestUser(messages)

    expect(activeAssistantMessageId).toBeNull()
    expect(shouldShowPendingAssistantTurnPlaceholder({
      pending: true,
      activeAssistantMessageId,
      hasVisibleAssistantText: false,
    })).toBe(true)
  })

  it('shows a stable pending assistant placeholder only before the current assistant message exists and before visible text', () => {
    expect(shouldShowPendingAssistantTurnPlaceholder({
      pending: true,
      activeAssistantMessageId: null,
      hasVisibleAssistantText: false,
    })).toBe(true)
    expect(shouldShowPendingAssistantTurnPlaceholder({
      pending: true,
      activeAssistantMessageId: 'assistant-current',
      hasVisibleAssistantText: false,
    })).toBe(false)
    expect(shouldShowPendingAssistantTurnPlaceholder({
      pending: false,
      activeAssistantMessageId: null,
      hasVisibleAssistantText: false,
    })).toBe(false)
    expect(shouldShowPendingAssistantTurnPlaceholder({
      pending: true,
      activeAssistantMessageId: null,
      hasVisibleAssistantText: true,
    })).toBe(false)

    const html = renderToStaticMarkup(<WorkspaceAssistantPendingTurnPlaceholder />)
    expect(html).toContain('assistant-thinking-minimal')
    expect(html).toContain('flex flex-col gap-3 px-1 py-1')
  })

  it('renders the thinking placeholder while a server run remains pending after the chat stream is ready', () => {
    const html = renderToStaticMarkup(<WorkspaceAssistantPendingTurnPlaceholder />)

    expect(html).toContain('assistant-thinking-minimal')
  })

  it('keeps the inline thinking target through tool-only assistant updates until visible text starts', () => {
    const toolOnlyMessages: readonly Pick<UIMessage, 'id' | 'role' | 'parts'>[] = [
      turnMessage('user-current', 'user', [{ type: 'text', text: '生成一段剧本' }]),
      turnMessage('assistant-current', 'assistant', [
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
          type: 'dynamic-tool',
          toolCallId: 'tool-call-1',
          state: 'output-available',
          output: { ok: true },
        } as never,
      ]),
    ]

    const toolOnlyHasText = hasWorkspaceAssistantVisibleTextAfterLatestUser(toolOnlyMessages)
    const toolOnlyHasPendingActivity = hasWorkspaceAssistantPendingActivityAfterLatestUser(toolOnlyMessages)

    expect(toolOnlyHasText).toBe(false)
    expect(toolOnlyHasPendingActivity).toBe(true)
    expect(resolveWorkspaceAssistantActiveThinkingMessageId({
      pending: toolOnlyHasPendingActivity,
      hasVisibleAssistantText: toolOnlyHasText,
      messages: toolOnlyMessages,
    })).toBe('assistant-current')
    expect(shouldShowPendingAssistantTurnPlaceholder({
      pending: true,
      activeAssistantMessageId: 'assistant-current',
      hasVisibleAssistantText: toolOnlyHasText,
    })).toBe(false)

    const textStartedMessages: readonly Pick<UIMessage, 'id' | 'role' | 'parts'>[] = [
      turnMessage('user-current', 'user', [{ type: 'text', text: '生成一段剧本' }]),
      turnMessage('assistant-current', 'assistant', [
        {
          type: 'data-agent-run',
          data: {
            runId: 'run-1',
            requestId: 'request-1',
            status: 'running',
            controlKind: 'user_turn',
          },
        } as never,
        { type: 'text', text: '这里是开场。' },
      ]),
    ]

    const textStartedHasText = hasWorkspaceAssistantVisibleTextAfterLatestUser(textStartedMessages)
    const textStartedHasPendingActivity = hasWorkspaceAssistantPendingActivityAfterLatestUser(textStartedMessages)

    expect(textStartedHasText).toBe(true)
    expect(textStartedHasPendingActivity).toBe(false)
    expect(resolveWorkspaceAssistantActiveThinkingMessageId({
      pending: true,
      hasVisibleAssistantText: textStartedHasText,
      messages: textStartedMessages,
    })).toBeNull()
    expect(shouldShowPendingAssistantTurnPlaceholder({
      pending: true,
      activeAssistantMessageId: null,
      hasVisibleAssistantText: textStartedHasText,
    })).toBe(false)
  })

  it('does not keep thinking after a terminal pause part takes over the turn', () => {
    const terminalMessages: readonly Pick<UIMessage, 'id' | 'role' | 'parts'>[] = [
      turnMessage('user-current', 'user', [{ type: 'text', text: '生成一段剧本' }]),
      turnMessage('assistant-current', 'assistant', [
        {
          type: 'dynamic-tool',
          toolCallId: 'tool-call-1',
          state: 'output-available',
          output: { ok: true },
        } as never,
        {
          type: 'data-agent-stop',
          data: {
            reason: 'awaiting_external_task',
            stepCount: 1,
            operationIds: ['generate_edit_screenplay'],
            taskIds: ['task-1'],
            phases: ['edit_script'],
          },
        } as never,
      ]),
    ]

    expect(hasWorkspaceAssistantVisibleTextAfterLatestUser(terminalMessages)).toBe(false)
    expect(hasWorkspaceAssistantPendingActivityAfterLatestUser(terminalMessages)).toBe(false)
    expect(resolveWorkspaceAssistantActiveThinkingMessageId({
      pending: hasWorkspaceAssistantPendingActivityAfterLatestUser(terminalMessages),
      hasVisibleAssistantText: false,
      messages: terminalMessages,
    })).toBeNull()
  })
})
