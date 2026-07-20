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
import { TASK_TYPE } from '@/lib/task/types'

describe('project agent session-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockImplementation(async (args?: unknown) => (
      args
      && typeof args === 'object'
      && 'where' in args
      && args.where
      && typeof args.where === 'object'
      && 'type' in args.where
      && args.where.type === TASK_TYPE.CREATIVE_WORK
        ? []
        : [{
            id: 'task-1',
            operationId: 'generate_edit_script_assets',
            type: 'image_location',
            targetType: 'LocationImage',
            targetId: 'location-image-1',
            status: 'processing',
          }]
    ))
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

  it('returns pending approval and active task state from server rows after refresh', async () => {
    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.pendingInteraction).toEqual({
      kind: 'approval',
      runId: 'run-1',
      interruptionId: 'interruption-1',
      approvalId: 'approval-1',
      operationId: 'generate_edit_script_assets',
      toolCallId: 'tool-1',
      operationPlan: null,
    })
    expect(state.currentRun).toEqual({
      runId: 'run-1',
      status: 'awaiting_task',
      controlKind: 'approval_response',
      errorCode: null,
      errorMessage: null,
    })
    expect(state.currentActivity).toEqual(expect.objectContaining({
      runId: 'run-1',
      type: 'waiting_task',
      status: 'waiting',
      operationId: 'generate_edit_script_assets',
    }))
    expect(state.activeWaits.map((wait) => wait.operationId)).toEqual(['generate_edit_script_assets'])
    expect(state.activeTasks).toEqual([{
      taskId: 'task-1',
      operationId: 'generate_edit_script_assets',
      taskType: 'image_location',
      targetType: 'LocationImage',
      targetId: 'location-image-1',
      status: 'processing',
    }])
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: { not: TASK_TYPE.CREATIVE_WORK },
      }),
    }))
  })

  it('fails explicitly instead of choosing one of multiple active Runs', async () => {
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([
      {
        id: 'run-1',
        status: 'awaiting_task',
        controlKind: 'approval_response',
        errorCode: null,
        errorMessage: null,
      },
      {
        id: 'run-2',
        status: 'running',
        controlKind: 'user_turn',
        errorCode: null,
        errorMessage: null,
      },
    ])

    await expect(getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })).rejects.toThrow('PROJECT_AGENT_SESSION_ACTIVE_RUN_CONFLICT:run-1,run-2')
  })

  it('fails explicitly when a pending Interruption belongs to a different Run', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { kind: 'INTERRUPTION', id: 'interruption-foreign', runId: 'run-foreign' },
    ])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce({
      id: 'interruption-foreign',
      runId: 'run-foreign',
      activityId: 'activity-foreign',
      type: 'approval',
      status: 'pending',
      operationId: 'generate_edit_script_assets',
      approvalId: 'approval-foreign',
      toolCallId: 'tool-foreign',
      payload: {},
    })

    await expect(getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })).rejects.toThrow(
      'PROJECT_AGENT_SESSION_INTERRUPTION_RUN_MISMATCH:interruption-foreign:run-foreign:run-1',
    )
  })

  it('fails explicitly when an open Wait belongs to a different Run', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { kind: 'WAIT', id: 'wait-foreign', runId: 'run-foreign' },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([{
      runId: 'run-foreign',
      waitId: 'wait-foreign',
      operationId: 'generate_edit_script_assets',
      taskIds: ['task-1'],
      failedTaskIds: [],
      status: 'pending',
      followUpMode: 'resume_agent',
      terminalStatus: null,
      total: 1,
      claimId: null,
    }])

    await expect(getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })).rejects.toThrow('PROJECT_AGENT_SESSION_WAIT_RUN_MISMATCH:wait-foreign:run-foreign:run-1')
  })

  it('fails explicitly when the open Activity belongs to a different Run', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { kind: 'ACTIVITY', id: 'activity-foreign', runId: 'run-foreign' },
    ])
    eventMock.getCurrentProjectAgentActivity.mockResolvedValueOnce({
      activityId: 'activity-foreign',
      runId: 'run-foreign',
      type: 'waiting_task',
      status: 'waiting',
      operationId: 'generate_edit_script_assets',
      sourceOperationId: null,
      toolCallId: null,
      choiceType: null,
    })

    await expect(getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })).rejects.toThrow(
      'PROJECT_AGENT_SESSION_ACTIVITY_RUN_MISMATCH:activity-foreign:run-foreign:run-1',
    )
  })
})
