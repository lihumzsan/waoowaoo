import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { findPendingToolApprovalId } from '@/lib/project-agent/ui-message-approval'

describe('findPendingToolApprovalId', () => {
  it('returns the latest pending approval id from assistant tool parts', () => {
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-generate_edit_script',
          toolCallId: 'tool-1',
          state: 'approval-requested',
          input: {},
          approval: { id: 'approval-1' },
        },
        {
          type: 'tool-generate_edit_script_assets',
          toolCallId: 'tool-2',
          state: 'approval-requested',
          input: {},
          approval: { id: 'approval-2' },
        },
      ],
    }] satisfies UIMessage[]

    expect(findPendingToolApprovalId(messages)).toBe('approval-2')
  })

  it('ignores approval responses because they already satisfy the SDK tool result chain', () => {
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-generate_edit_script',
          toolCallId: 'tool-1',
          state: 'approval-responded',
          input: {},
          approval: { id: 'approval-1', approved: false, reason: 'user_interrupted' },
        },
      ],
    }] satisfies UIMessage[]

    expect(findPendingToolApprovalId(messages)).toBeNull()
  })
})
