import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  collectPendingConfirmationActions,
  removeConfirmationRequestFromMessages,
} from '@/features/project-workspace/components/workspace-assistant/approval-state'

function buildMessages(): UIMessage[] {
  return [
    {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'plan created' },
      ],
    },
    {
      id: 'assistant-2',
      role: 'assistant',
      parts: [
        {
          type: 'data-confirmation-request',
          data: {
            operationId: 'regenerate_panel_image',
            summary: 'Need confirmation',
            toolCallId: 'tool-call-1',
            argsHint: {
              panelId: 'panel-1',
              confirmed: true,
            },
          },
        },
      ],
    },
  ]
}

describe('workspace assistant confirmation state', () => {
  it('collects pending confirmations from persisted messages', () => {
    const confirmations = collectPendingConfirmationActions(buildMessages())

    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]?.operationId).toBe('regenerate_panel_image')
  })

  it('removes resolved confirmation requests while preserving other messages', () => {
    const nextMessages = removeConfirmationRequestFromMessages(buildMessages(), 'regenerate_panel_image')

    expect(nextMessages).toHaveLength(1)
    expect(nextMessages[0]?.id).toBe('assistant-1')
  })

  it('does not collect confirmations after their tool output is available', () => {
    const messages = buildMessages()
    messages[1]?.parts.push({
      type: 'dynamic-tool',
      toolCallId: 'tool-call-1',
      state: 'output-available',
      output: { ok: true },
    } as UIMessage['parts'][number])

    const confirmations = collectPendingConfirmationActions(messages)

    expect(confirmations).toHaveLength(0)
  })

  it('does not collect legacy confirmations without a tool call id', () => {
    const messages = buildMessages()
    const confirmation = messages[1]?.parts[0]
    if (confirmation && typeof confirmation === 'object' && 'data' in confirmation) {
      confirmation.data = {
        operationId: 'regenerate_panel_image',
        summary: 'Need confirmation',
      }
    }

    const confirmations = collectPendingConfirmationActions(messages)

    expect(confirmations).toHaveLength(0)
  })
})
