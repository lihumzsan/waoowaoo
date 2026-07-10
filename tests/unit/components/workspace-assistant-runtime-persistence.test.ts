import {
  createWorkspaceAssistantControlMessageId,
  createWorkspaceAssistantControlVisibleUserMessage,
  describe,
  expect,
  it,
  mergeWorkspaceAssistantPersistedMessages,
  mergeWorkspaceAssistantStreamedMessage,
  shouldRefetchWorkspaceAssistantThreadForRunTransition,
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
      text: '  把祠堂场景调得更旧  ',
      nonce: 'nonce-1',
    })).toEqual({
      id: 'workspace-control-user:choice:run-1:nonce-1',
      role: 'user',
      parts: [{ type: 'text', text: '把祠堂场景调得更旧' }],
    })
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

  it('refetches the persisted thread when server run lifecycle edges can commit messages', () => {
    expect(shouldRefetchWorkspaceAssistantThreadForRunTransition({
      previousRun: null,
      currentRun: { runId: 'run-1', status: 'running' },
    })).toBe(true)
    expect(shouldRefetchWorkspaceAssistantThreadForRunTransition({
      previousRun: { runId: 'run-1', status: 'running' },
      currentRun: { runId: 'run-1', status: 'completed' },
    })).toBe(true)
    expect(shouldRefetchWorkspaceAssistantThreadForRunTransition({
      previousRun: { runId: 'run-1', status: 'running' },
      currentRun: { runId: 'run-1', status: 'awaiting_choice' },
    })).toBe(true)
    expect(shouldRefetchWorkspaceAssistantThreadForRunTransition({
      previousRun: { runId: 'run-1', status: 'awaiting_task' },
      currentRun: null,
    })).toBe(true)
    expect(shouldRefetchWorkspaceAssistantThreadForRunTransition({
      previousRun: { runId: 'run-1', status: 'running' },
      currentRun: { runId: 'run-1', status: 'running' },
    })).toBe(false)
  })
})
