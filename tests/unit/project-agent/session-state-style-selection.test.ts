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

  it('does not expose a selectable style card without a run-bound wait or choice activity', async () => {
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([{
      id: 'run-completed-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-completed-1',
      status: 'completed',
      controlKind: 'choice_response',
      stopReason: 'completed',
    }])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce(null)
    eventMock.getCurrentProjectAgentActivity.mockResolvedValueOnce(null)
    prismaMock.projectEditBible.findFirst.mockResolvedValueOnce({
      id: 'bible-1',
      episode: { projectId: 'project-1' },
      episodeId: 'episode-1',
      stylePreviews: [{
        id: 'style-preview-a',
        styleKey: 'style_a',
        title: '风格 A',
        summary: '已完成但没有等待选择的 Agent run',
        taskId: 'task-style-a',
        aspectRatio: '16:9',
        status: 'completed',
      }],
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.activeStylePreviewGeneration).toBeNull()
  })
})
