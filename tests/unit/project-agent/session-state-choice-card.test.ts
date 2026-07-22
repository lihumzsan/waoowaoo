import {
  beforeEach,
  describe,
  eventMock,
  expect,
  getProjectAgentSessionState,
  interruptionsMock,
  it,
  prismaMock,
  runsMock,
  vi,
  waitsMock,
} from './session-state.fixture'

const offer = {
  card: {
    cardId: 'choice-current-question-1',
    runId: 'run-choice-1',
    interruptionId: 'choice-interruption-1',
    toolCallId: 'tool-choice-1',
    mode: 'select',
    replyMode: 'none',
    title: '选择当前视觉方向',
    description: '此选择只决定当前采用的视觉方向。',
    groups: [{
      key: 'direction',
      label: '视觉方向',
      required: true,
      presentation: 'options',
      options: [
        { value: 'quiet', label: '克制写实' },
        { value: 'bold', label: '强烈表现' },
      ],
    }],
    submitLabel: '确认选择',
  },
  subject: {
    kind: 'none',
    fingerprint: '0'.repeat(64),
  },
  commitments: [],
}

describe('project agent session-state generic Choice projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$queryRaw.mockResolvedValue([
      { kind: 'INTERRUPTION', id: 'choice-interruption-1', runId: 'run-choice-1' },
      { kind: 'ACTIVITY', id: 'activity-choice-1', runId: 'run-choice-1' },
    ])
    prismaMock.projectAgentRun.findMany.mockResolvedValue([{
      id: 'run-choice-1',
      status: 'awaiting_choice',
      controlKind: 'user_turn',
      errorCode: null,
      errorMessage: null,
    }])
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValue([{
      id: 'run-choice-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-choice-1',
      status: 'awaiting_choice',
      controlKind: 'user_turn',
      stopReason: 'awaiting_user_choice',
    }])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValue([])
    eventMock.getCurrentProjectAgentActivity.mockResolvedValue({
      activityId: 'activity-choice-1',
      runId: 'run-choice-1',
      type: 'awaiting_choice',
      status: 'waiting',
      operationId: 'request_choice',
      sourceOperationId: null,
      toolCallId: 'tool-choice-1',
    })
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValue({
      id: 'choice-interruption-1',
      runId: 'run-choice-1',
      activityId: 'activity-choice-1',
      type: 'choice',
      status: 'pending',
      operationId: 'request_choice',
      approvalId: 'choice:approval-1',
      toolCallId: 'tool-choice-1',
      payload: offer,
    })
  })

  it('rebuilds the exact persisted model-authored card without a workflow-specific builder', async () => {
    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.pendingInteraction).toEqual({
      kind: 'choice',
      runId: 'run-choice-1',
      interruptionId: 'choice-interruption-1',
      approvalId: 'choice:approval-1',
      operationId: 'request_choice',
      toolCallId: 'tool-choice-1',
      choiceCard: offer.card,
    })
  })

  it('fails closed when the persisted card identity does not match the interruption', async () => {
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-choice-1',
      activityId: 'activity-choice-1',
      type: 'choice',
      status: 'pending',
      operationId: 'request_choice',
      approvalId: 'choice:approval-1',
      toolCallId: 'tool-choice-1',
      payload: {
        ...offer,
        card: { ...offer.card, runId: 'run-stale' },
      },
    })

    await expect(getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })).rejects.toThrow('PROJECT_AGENT_PENDING_CHOICE_OFFER_IDENTITY_MISMATCH')
  })
})
