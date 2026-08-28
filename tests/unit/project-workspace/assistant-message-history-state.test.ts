import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  createAssistantMessageHistoryState,
  reduceAssistantMessageHistoryState,
  type AssistantMessageHistoryRequestIdentity,
} from '@/features/project-workspace/components/workspace-assistant/assistant-message-history-state'

function message(id: string): UIMessage {
  return {
    id,
    role: id.startsWith('assistant-') ? 'assistant' : 'user',
    parts: [{ type: 'text', text: id }],
  }
}

const firstRequest: AssistantMessageHistoryRequestIdentity = {
  requestId: 1,
  scopeKey: 'project-1',
  threadId: 'thread-1',
  before: '51',
}

describe('workspace assistant message history state', () => {
  it('invalidates an in-flight page when the latest cursor advances and rejects its late response', () => {
    const initial = createAssistantMessageHistoryState({
      scopeKey: 'project-1',
      threadId: 'thread-1',
      messages: [message('user-51'), message('assistant-100')],
      before: '51',
      hasMore: true,
    })
    const loading = reduceAssistantMessageHistoryState(initial, {
      type: 'load_started',
      request: firstRequest,
    })

    const refreshed = reduceAssistantMessageHistoryState(loading, {
      type: 'view_synced',
      page: {
        scopeKey: 'project-1',
        threadId: 'thread-1',
        messages: [message('user-52'), message('assistant-101')],
        before: '52',
        hasMore: true,
      },
    })

    expect(refreshed.activeRequest).toBeNull()
    expect(refreshed.before).toBe('52')

    const afterLateSuccess = reduceAssistantMessageHistoryState(refreshed, {
      type: 'load_succeeded',
      request: firstRequest,
      page: {
        messages: [message('user-1')],
        before: null,
        hasMore: false,
      },
    })

    expect(afterLateSuccess).toBe(refreshed)
    expect(afterLateSuccess.messages.map((item) => item.id)).toEqual([
      'user-52',
      'assistant-101',
    ])
  })

  it('only lets the current request clear its loading projection', () => {
    const initial = createAssistantMessageHistoryState({
      scopeKey: 'project-1',
      threadId: 'thread-1',
      messages: [message('user-51')],
      before: '51',
      hasMore: true,
    })
    const loading = reduceAssistantMessageHistoryState(initial, {
      type: 'load_started',
      request: firstRequest,
    })
    const staleRequest = { ...firstRequest, requestId: 0 }

    expect(reduceAssistantMessageHistoryState(loading, {
      type: 'load_failed',
      request: staleRequest,
    })).toBe(loading)

    const failed = reduceAssistantMessageHistoryState(loading, {
      type: 'load_failed',
      request: firstRequest,
    })
    expect(failed.activeRequest).toBeNull()
    expect(failed.before).toBe('51')
    expect(failed.hasMore).toBe(true)
  })
})
