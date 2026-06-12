import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  ensureUniqueUIMessages,
  isPersistableUIMessages,
  validatePersistableUIMessages,
} from '@/lib/project-agent/ui-message-validation'

describe('isPersistableUIMessages', () => {
  it('rejects non-array input', () => {
    expect(isPersistableUIMessages({})).toBe(false)
  })

  it('rejects messages missing required core fields', () => {
    expect(isPersistableUIMessages([{ role: 'assistant', parts: [{ type: 'text', text: 'hi' }] }])).toBe(false)
    expect(isPersistableUIMessages([{ id: 'x', role: 'assistant', parts: [] }])).toBe(false)
  })

  it('returns a concrete validation error for empty assistant message ids', () => {
    expect(validatePersistableUIMessages([
      {
        id: '',
        role: 'assistant',
        parts: [{ type: 'text', text: 'control response' }],
      },
    ])).toEqual({
      ok: false,
      error: {
        code: 'message_id_missing',
        messageIndex: 0,
      },
    })
  })

  it('accepts a minimal valid UIMessage list', () => {
    expect(isPersistableUIMessages([
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      },
    ])).toBe(true)
  })
})

describe('ensureUniqueUIMessages', () => {
  it('rewrites later duplicate message ids while preserving message content', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'first' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'second' }],
      },
      {
        id: 'assistant-1--dedup-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'existing suffix' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'third' }],
      },
    ]

    expect(ensureUniqueUIMessages(messages)).toEqual([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'first' }],
      },
      {
        id: 'assistant-1--dedup-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'second' }],
      },
      {
        id: 'assistant-1--dedup-1--dedup-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'existing suffix' }],
      },
      {
        id: 'assistant-1--dedup-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'third' }],
      },
    ])
  })
})
