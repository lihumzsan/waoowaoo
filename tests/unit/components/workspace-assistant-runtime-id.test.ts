import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceAssistantChatId,
  createWorkspaceAssistantControlMessageId,
  createWorkspaceAssistantControlVisibleUserMessage,
  isWorkspaceAssistantOperationPendingStatus,
  isWorkspaceAssistantRunBusyStatus,
  mergeWorkspaceAssistantStreamedMessage,
  resolveWorkspaceAssistantPendingOperationId,
  shouldClearWorkspaceAssistantControlPending,
  shouldPollWorkspaceAssistantSessionState,
  shouldSendWorkspaceAssistantAutomatically,
} from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime'
import {
  mergeWorkspaceAssistantPersistedMessages,
  shouldRefetchWorkspaceAssistantThreadForRunTransition,
} from '@/features/project-workspace/components/workspace-assistant/thread-sync'

describe('workspace assistant runtime chat id', () => {
  it('scopes chat sessions by project and episode only', () => {
    const episodeId = buildWorkspaceAssistantChatId({
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
    const globalId = buildWorkspaceAssistantChatId({
      projectId: 'project-1',
    })

    expect(episodeId).toBe('workspace-command:project-1:episode-1')
    expect(globalId).toBe('workspace-command:project-1:global')
    expect(episodeId).not.toBe(globalId)
  })

  it('keeps AI SDK automatic tool-loop sending disabled for the Agents SDK runtime', () => {
    expect(shouldSendWorkspaceAssistantAutomatically()).toBe(false)
  })

  it('uses server run status as the global assistant busy signal', () => {
    expect(isWorkspaceAssistantRunBusyStatus('running')).toBe(true)
    expect(shouldClearWorkspaceAssistantControlPending('running')).toBe(false)
    expect(isWorkspaceAssistantRunBusyStatus('awaiting_task')).toBe(false)
    expect(shouldClearWorkspaceAssistantControlPending('awaiting_task')).toBe(false)

    for (const status of [
      'awaiting_approval',
      'awaiting_choice',
      'completed',
      'failed',
      'cancelled',
    ] as const) {
      expect(isWorkspaceAssistantRunBusyStatus(status)).toBe(false)
      expect(shouldClearWorkspaceAssistantControlPending(status)).toBe(true)
    }
  })

  it('uses running and awaiting-task runs as operation pending signals', () => {
    expect(isWorkspaceAssistantOperationPendingStatus('running')).toBe(true)
    expect(isWorkspaceAssistantOperationPendingStatus('awaiting_task')).toBe(true)
    expect(isWorkspaceAssistantOperationPendingStatus('awaiting_choice')).toBe(false)
    expect(isWorkspaceAssistantOperationPendingStatus('awaiting_approval')).toBe(false)
    expect(isWorkspaceAssistantOperationPendingStatus('completed')).toBe(false)
  })

  it('polls session-state only while server-side progress can change without user input', () => {
    expect(shouldPollWorkspaceAssistantSessionState({
      chatStatus: 'submitted',
      controlPending: false,
      sessionState: null,
    })).toBe(true)
    expect(shouldPollWorkspaceAssistantSessionState({
      chatStatus: 'ready',
      controlPending: true,
      sessionState: null,
    })).toBe(true)
    expect(shouldPollWorkspaceAssistantSessionState({
      chatStatus: 'ready',
      controlPending: false,
      sessionState: {
        currentRun: { status: 'running' },
        activeWaits: [],
      },
    })).toBe(true)
    expect(shouldPollWorkspaceAssistantSessionState({
      chatStatus: 'ready',
      controlPending: false,
      sessionState: {
        currentRun: { status: 'awaiting_task' },
        activeWaits: [],
      },
    })).toBe(false)
    expect(shouldPollWorkspaceAssistantSessionState({
      chatStatus: 'ready',
      controlPending: false,
      sessionState: {
        currentRun: { status: 'awaiting_task' },
        activeWaits: [{ status: 'pending' }],
      },
    })).toBe(true)
    expect(shouldPollWorkspaceAssistantSessionState({
      chatStatus: 'ready',
      controlPending: false,
      sessionState: {
        currentRun: { status: 'awaiting_approval' },
        activeWaits: [],
      },
    })).toBe(false)
    expect(shouldPollWorkspaceAssistantSessionState({
      chatStatus: 'ready',
      controlPending: false,
      sessionState: {
        currentRun: { status: 'awaiting_choice' },
        activeWaits: [],
      },
    })).toBe(false)
    expect(shouldPollWorkspaceAssistantSessionState({
      chatStatus: 'ready',
      controlPending: false,
      sessionState: {
        currentRun: { status: 'completed' },
        activeWaits: [{ status: 'resolved' }],
      },
    })).toBe(true)
  })

  it('never reports a pending operation while a denial is being delivered', () => {
    expect(resolveWorkspaceAssistantPendingOperationId({
      operationId: 'generate_edit_script',
      intent: 'deny',
      status: 'running',
    })).toBeNull()
    expect(resolveWorkspaceAssistantPendingOperationId({
      operationId: 'generate_edit_script',
      intent: 'approve',
      status: 'running',
    })).toBe('generate_edit_script')
    expect(resolveWorkspaceAssistantPendingOperationId({
      operationId: 'generate_edit_style_previews',
      intent: null,
      status: 'awaiting_task',
    })).toBe('generate_edit_style_previews')
    expect(resolveWorkspaceAssistantPendingOperationId({
      operationId: 'generate_edit_style_previews',
      intent: null,
      status: 'awaiting_choice',
    })).toBeNull()
    expect(resolveWorkspaceAssistantPendingOperationId(null)).toBeNull()
  })

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
