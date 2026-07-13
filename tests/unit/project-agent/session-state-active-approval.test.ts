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
    workflowMock.resolveEditFirstWorkflowView.mockResolvedValue(workflow)
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

  it('keeps the approved operation visible while the approval response run is active', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { kind: 'ACTIVITY', id: 'activity-active-1', runId: 'run-active-1' },
    ])
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([{
      id: 'run-active-1',
      status: 'running',
      controlKind: 'user_turn',
      errorCode: null,
      errorMessage: null,
    }])
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([
      {
        id: 'run-active-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-active-1',
        status: 'running',
        controlKind: 'user_turn',
        stopReason: 'approval_response',
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce(null)
    eventMock.getCurrentProjectAgentActivity.mockResolvedValueOnce({
      activityId: 'activity-active-1',
      runId: 'run-active-1',
      type: 'operation',
      status: 'running',
      operationId: 'generate_edit_shot_execution_plan',
      sourceOperationId: null,
      toolCallId: 'tool-active-1',
      choiceType: null,
    })
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce({
      id: 'interruption-active-1',
      runId: 'run-active-1',
      activityId: 'activity-active-1',
      type: 'approval',
      status: 'consumed',
      operationId: 'generate_edit_shot_execution_plan',
      approvalId: 'approval-active-1',
      toolCallId: 'tool-active-1',
      payload: {},
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.currentRun).toEqual({
      runId: 'run-active-1',
      status: 'running',
      controlKind: 'user_turn',
      errorCode: null,
      errorMessage: null,
    })
    expect(state.currentActivity).toEqual(expect.objectContaining({
      runId: 'run-active-1',
      type: 'operation',
      operationId: 'generate_edit_shot_execution_plan',
    }))
  })
})
