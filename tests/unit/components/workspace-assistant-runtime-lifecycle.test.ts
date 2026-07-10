import {
  buildWorkspaceAssistantChatId,
  canStopWorkspaceAssistantReply,
  describe,
  expect,
  isWorkspaceAssistantOperationPendingStatus,
  isWorkspaceAssistantRunBusyStatus,
  it,
  resolveWorkspaceAssistantPendingOperationId,
  shouldClearWorkspaceAssistantControlPending,
  shouldPollWorkspaceAssistantSessionState,
  shouldSendWorkspaceAssistantAutomatically,
} from './workspace-assistant-runtime.fixture'

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

  it('allows stopping only while a local assistant response transport is active', () => {
    expect(canStopWorkspaceAssistantReply({
      chatStatus: 'submitted',
      controlRequestActive: false,
    })).toBe(true)
    expect(canStopWorkspaceAssistantReply({
      chatStatus: 'streaming',
      controlRequestActive: false,
    })).toBe(true)
    expect(canStopWorkspaceAssistantReply({
      chatStatus: 'ready',
      controlRequestActive: true,
    })).toBe(true)
    expect(canStopWorkspaceAssistantReply({
      chatStatus: 'ready',
      controlRequestActive: false,
    })).toBe(false)
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
})
