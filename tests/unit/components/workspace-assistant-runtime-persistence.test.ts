import {
  createWorkspaceAssistantControlMessageId,
  createWorkspaceAssistantControlVisibleUserMessage,
  describe,
  expect,
  it,
  mergeWorkspaceAssistantPersistedMessages,
  mergeWorkspaceAssistantStreamedMessage,
  resolveWorkspaceAssistantThreadSnapshotMessages,
} from './workspace-assistant-runtime.fixture'

describe('workspace assistant runtime chat id', () => {
  it('creates a stable non-empty assistant message id for run-scoped control streams', () => {
    expect(createWorkspaceAssistantControlMessageId({
      runId: ' run-1 ',
      endpoint: 'choice',
      nonce: 'nonce-1',
    })).toBe('workspace-control:choice:run-1:nonce-1')
  })

  it('creates visible user messages for free-text choice card feedback', () => {
    expect(createWorkspaceAssistantControlVisibleUserMessage({
      runId: ' run-1 ',
      endpoint: 'choice',
      interruptionId: ' interruption-1 ',
      text: '  把祠堂场景调得更旧  ',
    })).toEqual({
      id: 'workspace-control-user:choice_response:run-1:interruption-1',
      role: 'user',
      parts: [{ type: 'text', text: '把祠堂场景调得更旧' }],
    })
  })

  it('deduplicates the optimistic control message when the canonical thread snapshot arrives', () => {
    const optimistic = createWorkspaceAssistantControlVisibleUserMessage({
      runId: 'run-1',
      endpoint: 'choice',
      interruptionId: 'interruption-1',
      text: '把祠堂场景调得更旧',
    })
    const merged = mergeWorkspaceAssistantPersistedMessages([optimistic], [{
      ...optimistic,
      parts: [{ type: 'text', text: '把祠堂场景调得更旧（服务端）' }],
    }])

    expect(merged).toEqual([{
      id: 'workspace-control-user:choice_response:run-1:interruption-1',
      role: 'user',
      parts: [{ type: 'text', text: '把祠堂场景调得更旧（服务端）' }],
    }])
  })

  it('rejects control stream messages with empty ids before they can freeze persistence', () => {
    expect(() => mergeWorkspaceAssistantStreamedMessage([], {
      id: '',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello' }],
    })).toThrow('PROJECT_ASSISTANT_STREAM_MESSAGE_ID_EMPTY')
  })

  it('merges streamed control updates by their concrete message id', () => {
    const current = mergeWorkspaceAssistantStreamedMessage([], {
      id: 'workspace-control:choice:run-1:nonce-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'first chunk' }],
    })
    const next = mergeWorkspaceAssistantStreamedMessage(current, {
      id: 'workspace-control:choice:run-1:nonce-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'final chunk' }],
    })

    expect(next).toEqual([
      {
        id: 'workspace-control:choice:run-1:nonce-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'final chunk' }],
      },
    ])
  })

  it('keeps optimistic user messages when a reload recovery fetch returns an older thread snapshot', () => {
    const merged = mergeWorkspaceAssistantPersistedMessages([
      {
        id: 'assistant-existing',
        role: 'assistant',
        parts: [{ type: 'text', text: '已有回复' }],
      },
      {
        id: 'user-optimistic',
        role: 'user',
        parts: [{ type: 'text', text: '你好' }],
      },
    ], [
      {
        id: 'assistant-existing',
        role: 'assistant',
        parts: [{ type: 'text', text: '已有回复' }],
      },
    ])

    expect(merged).toEqual([
      {
        id: 'assistant-existing',
        role: 'assistant',
        parts: [{ type: 'text', text: '已有回复' }],
      },
      {
        id: 'user-optimistic',
        role: 'user',
        parts: [{ type: 'text', text: '你好' }],
      },
    ])
  })

  it('uses the persisted server message when reload recovery catches up to the committed id', () => {
    const merged = mergeWorkspaceAssistantPersistedMessages([
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: '本地文本' }],
      },
      {
        id: 'assistant-local',
        role: 'assistant',
        parts: [{ type: 'text', text: 'streaming' }],
      },
    ], [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: '服务端文本' }],
      },
      {
        id: 'assistant-final',
        role: 'assistant',
        parts: [{ type: 'text', text: '最终回复' }],
      },
    ])

    expect(merged).toEqual([
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: '服务端文本' }],
      },
      {
        id: 'assistant-final',
        role: 'assistant',
        parts: [{ type: 'text', text: '最终回复' }],
      },
      {
        id: 'assistant-local',
        role: 'assistant',
        parts: [{ type: 'text', text: 'streaming' }],
      },
    ])
  })

  it('replaces all historical messages when a fresh authoritative Thread snapshot is empty', () => {
    const resolved = resolveWorkspaceAssistantThreadSnapshotMessages([
      {
        id: 'old-user',
        role: 'user',
        parts: [{ type: 'text', text: 'old' }],
      },
      {
        id: 'old-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'old reply' }],
      },
    ], null)

    expect(resolved).toEqual([])
  })

})
