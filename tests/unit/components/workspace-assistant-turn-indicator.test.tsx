import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  findLatestAssistantMessageIdAfterLatestUser,
  shouldShowPendingAssistantTurnPlaceholder,
  WorkspaceAssistantPendingTurnPlaceholder,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'

function message(id: string, role: UIMessage['role']): Pick<UIMessage, 'id' | 'role'> {
  return { id, role }
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
      status: 'streaming',
      activeAssistantMessageId,
    })).toBe(true)
  })

  it('shows a stable pending assistant placeholder only before the current assistant message exists', () => {
    expect(shouldShowPendingAssistantTurnPlaceholder({
      status: 'submitted',
      activeAssistantMessageId: null,
    })).toBe(true)
    expect(shouldShowPendingAssistantTurnPlaceholder({
      status: 'streaming',
      activeAssistantMessageId: 'assistant-current',
    })).toBe(false)
    expect(shouldShowPendingAssistantTurnPlaceholder({
      status: 'ready',
      activeAssistantMessageId: null,
    })).toBe(false)
    expect(shouldShowPendingAssistantTurnPlaceholder({
      status: 'ready',
      activeAssistantMessageId: null,
      pending: true,
    })).toBe(true)

    const html = renderToStaticMarkup(<WorkspaceAssistantPendingTurnPlaceholder status="submitted" />)
    expect(html).toContain('assistant-thinking-minimal')
    expect(html).toContain('flex flex-col gap-3 px-1 py-1')
  })
})
