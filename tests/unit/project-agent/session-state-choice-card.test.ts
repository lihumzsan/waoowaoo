import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  beforeEach,
  choiceCardMock,
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
  workflow,
  workflowMock,
} from './session-state.fixture'

describe('project agent session-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        operationId: 'generate_edit_script_assets',
        type: 'image_location',
        targetType: 'LocationImage',
        targetId: 'location-image-1',
        status: 'processing',
      },
    ])
    prismaMock.projectEditBible.findFirst.mockResolvedValue(null)
    workflowMock.resolveEditFirstWorkflowState.mockResolvedValue(workflow)
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValue([
      {
        id: 'run-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-1',
        status: 'awaiting_task',
        controlKind: 'approval_response',
        stopReason: 'awaiting_task',
      },
    ])
    runsMock.cancelStaleRunningProjectAgentRunsForScope.mockResolvedValue([])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValue([
      {
        runId: 'run-1',
        waitId: 'wait-1',
        operationId: 'generate_edit_script_assets',
        taskIds: ['task-1'],
        failedTaskIds: [],
        status: 'pending',
        followUpMode: 'resume_agent',
        terminalStatus: null,
        total: 1,
        claimId: null,
      },
    ])
    eventMock.getCurrentProjectAgentActivity.mockResolvedValue({
      activityId: 'activity-wait-1',
      runId: 'run-1',
      type: 'waiting_task',
      status: 'waiting',
      operationId: 'generate_edit_script_assets',
      sourceOperationId: null,
      toolCallId: null,
      choiceType: null,
    })
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValue({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-approval-1',
      type: 'approval',
      status: 'pending',
      operationId: 'generate_edit_script_assets',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      payload: {},
    })
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValue({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-approval-1',
      type: 'approval',
      status: 'pending',
      operationId: 'generate_edit_script_assets',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      payload: {},
    })
  })

  it('rebuilds a pending choice card from the pending interruption row', async () => {
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([
      {
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
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-choice-1',
      activityId: 'activity-choice-1',
      type: 'choice',
      status: 'pending',
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
      approvalId: 'choice:approval-1',
      toolCallId: 'tool-choice-1',
      payload: {
        schemaVersion: 1,
        card: {
          cardId: 'edit-first-bible-review:plan-1',
          runId: 'run-choice-1',
          interruptionId: 'choice-interruption-1',
          toolCallId: 'tool-choice-1',
          choiceType: 'bible_review',
          title: '确认制作规划',
          groups: [],
          submitLabel: '确认制作规划',
          submit: { kind: 'submit_tool_output' },
        },
        reviewedResource: {
          kind: 'bible_review_plan',
          fingerprint: '0'.repeat(64),
        },
      },
    })
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-choice-1',
      activityId: 'activity-choice-1',
      type: 'choice',
      status: 'pending',
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
      approvalId: 'choice:approval-1',
      toolCallId: 'tool-choice-1',
      payload: {
        schemaVersion: 1,
        card: {
          cardId: 'edit-first-bible-review:plan-1',
          runId: 'run-choice-1',
          interruptionId: 'choice-interruption-1',
          toolCallId: 'tool-choice-1',
          choiceType: 'bible_review',
          title: '确认制作规划',
          groups: [],
          submitLabel: '确认制作规划',
          submit: { kind: 'submit_tool_output' },
        },
        reviewedResource: {
          kind: 'bible_review_plan',
          fingerprint: '0'.repeat(64),
        },
      },
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(choiceCardMock.buildEditFirstAssistantChoiceCard).not.toHaveBeenCalled()
    expect(state.pendingInteraction).toEqual(expect.objectContaining({
      kind: 'choice',
      runId: 'run-choice-1',
      interruptionId: 'choice-interruption-1',
      choiceType: 'bible_review',
      choiceCard: expect.objectContaining({
        runId: 'run-choice-1',
        interruptionId: 'choice-interruption-1',
      }),
    }))
  })
})
