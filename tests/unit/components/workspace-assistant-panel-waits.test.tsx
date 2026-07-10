import {
  describe,
  expect,
  it,
  join,
  readFileSync,
  shouldDeferWorkspaceAssistantTaskFollowUp,
  shouldPollWorkspaceAssistantWaitFollowUps,
  shouldShowWorkspaceAssistantRunFailureNotice,
} from './workspace-assistant-panel.fixture'

describe('workspace assistant panel layout', () => {
  it('periodically claims assistant waits only while an active wait can resolve', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )

    expect(panelSource).toContain('WORKSPACE_ASSISTANT_WAIT_FOLLOW_UP_POLL_MS')
    expect(panelSource).toContain('window.setInterval')
    expect(panelSource).toContain('shouldPollWaitFollowUps')
    expect(panelSource).toContain('flushResolvedWaitFollowUps')
    expect(shouldPollWorkspaceAssistantWaitFollowUps({
      storageLoading: true,
      sessionState: {
        activeWaits: [{ status: 'resolved' }],
      },
    })).toBe(false)
    expect(shouldPollWorkspaceAssistantWaitFollowUps({
      storageLoading: false,
      sessionState: null,
    })).toBe(false)
    expect(shouldPollWorkspaceAssistantWaitFollowUps({
      storageLoading: false,
      sessionState: {
        activeWaits: [],
      },
    })).toBe(false)
    expect(shouldPollWorkspaceAssistantWaitFollowUps({
      storageLoading: false,
      sessionState: {
        activeWaits: [{ status: 'pending' }],
      },
    })).toBe(true)
    expect(shouldPollWorkspaceAssistantWaitFollowUps({
      storageLoading: false,
      sessionState: {
        activeWaits: [{ status: 'claimed' }],
      },
    })).toBe(true)
  })

  it('does not defer task follow-up only because the current run is awaiting an external task', () => {
    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: 'awaiting_task',
    })).toBe(false)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'streaming',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: 'awaiting_task',
    })).toBe(true)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: true,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: 'awaiting_task',
    })).toBe(true)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: 'approval-1',
      currentRunStatus: 'awaiting_task',
    })).toBe(true)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: 'running',
    })).toBe(true)

    expect(shouldDeferWorkspaceAssistantTaskFollowUp({
      pending: true,
      controlPending: false,
      chatStatus: 'ready',
      storageLoading: false,
      pendingApprovalId: null,
      currentRunStatus: null,
    })).toBe(false)
  })

  it('shows failed run feedback only from session-state terminal failure', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )

    expect(panelSource).toContain('const composerError = showRunFailureNotice')
    expect(panelSource).toContain('? null')
    expect(panelSource).toContain('<WorkspaceAssistantRunFailureNotice run={assistantRuntime.sessionState?.currentRun ?? null} />')
    expect(shouldShowWorkspaceAssistantRunFailureNotice({
      storageLoading: false,
      replyInFlight: false,
      currentRunStatus: 'failed',
    })).toBe(true)

    expect(shouldShowWorkspaceAssistantRunFailureNotice({
      storageLoading: false,
      replyInFlight: false,
      currentRunStatus: 'running',
    })).toBe(false)

    expect(shouldShowWorkspaceAssistantRunFailureNotice({
      storageLoading: false,
      replyInFlight: false,
      currentRunStatus: null,
    })).toBe(false)

    expect(shouldShowWorkspaceAssistantRunFailureNotice({
      storageLoading: false,
      replyInFlight: true,
      currentRunStatus: 'failed',
    })).toBe(false)
  })
})
