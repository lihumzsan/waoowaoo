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

  it('does not project planned style rows as generating while billing approval is pending', async () => {
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([{
      id: 'run-style-approval-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-style-approval-1',
      status: 'awaiting_approval',
      controlKind: 'choice_response',
      stopReason: 'awaiting_approval',
    }])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce({
      id: 'style-approval-1',
      runId: 'run-style-approval-1',
      activityId: 'activity-style-approval-1',
      type: 'approval',
      status: 'pending',
      operationId: 'generate_edit_style_previews',
      approvalId: 'approval-style-1',
      toolCallId: 'tool-style-1',
      payload: {},
    })
    eventMock.getCurrentProjectAgentActivity.mockResolvedValueOnce({
      activityId: 'activity-style-approval-1',
      runId: 'run-style-approval-1',
      type: 'awaiting_approval',
      status: 'waiting',
      operationId: 'generate_edit_style_previews',
      sourceOperationId: null,
      toolCallId: 'tool-style-1',
      choiceType: null,
    })
    prismaMock.projectEditBible.findFirst.mockResolvedValueOnce({
      id: 'bible-1',
      episode: { projectId: 'project-1' },
      episodeId: 'episode-1',
      stylePreviews: [{
        id: 'style-preview-a',
        styleKey: 'style_a',
        title: '风格 A',
        summary: '等待用户批准报价',
        taskId: null,
        aspectRatio: '16:9',
        status: 'pending',
      }],
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.pendingInteraction).toEqual(expect.objectContaining({
      kind: 'approval',
      operationId: 'generate_edit_style_previews',
    }))
    expect(state.activeStylePreviewGeneration).toBeNull()
  })
})
