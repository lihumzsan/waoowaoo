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

  it('keeps the awaiting style preview run id on the rebuilt style choice card after refresh', async () => {
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([
      {
        id: 'run-style-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-style-1',
        status: 'awaiting_choice',
        controlKind: 'user_turn',
        stopReason: 'awaiting_user_choice',
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce(null)
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce(null)
    eventMock.getCurrentProjectAgentActivity.mockResolvedValueOnce({
      activityId: 'activity-style-choice-1',
      runId: 'run-style-1',
      type: 'awaiting_choice',
      status: 'waiting',
      operationId: null,
      sourceOperationId: 'generate_edit_style_previews',
      toolCallId: null,
      choiceType: 'style',
    })
    prismaMock.projectEditBible.findFirst.mockResolvedValueOnce({
      id: 'bible-1',
      projectId: 'project-1',
      episode: {
        projectId: 'project-1',
      },
      episodeId: 'episode-1',
      stylePreviews: [
        {
          id: 'style-preview-a',
          styleKey: 'style_a',
          title: '风格 A',
          summary: '风格 A 摘要',
          taskId: 'task-style-a',
          aspectRatio: '16:9',
          status: 'completed',
        },
      ],
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.currentRun).toEqual({
      runId: 'run-style-1',
      status: 'awaiting_choice',
      controlKind: 'user_turn',
      errorCode: null,
      errorMessage: null,
    })
    expect(state.activeStylePreviewGeneration?.data).toEqual(expect.objectContaining({
      operationId: 'generate_edit_style_previews',
      agentRunId: 'run-style-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      bibleId: 'bible-1',
      items: [
        expect.objectContaining({
          id: 'style-preview-a',
          taskId: 'task-style-a',
          aspectRatio: '16:9',
        }),
      ],
    }))
  })
})
