import {
  beforeEach,
  describe,
  eventMock,
  expect,
  getProjectAgentSessionState,
  interruptionsMock,
  it,
  mockSessionTaskRows,
  prismaMock,
  runsMock,
  vi,
  waitsMock,
} from './session-state.fixture'
import { TASK_TYPE } from '@/lib/task/types'

describe('project agent session-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionTaskRows([{
      id: 'task-1',
      operationId: 'create_image',
      type: 'creative_resource_image',
      targetType: 'CreativeResource',
      targetId: 'resource-image-1',
      status: 'processing',
    }])
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
        operationId: 'create_image',
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
      operationId: 'create_image',
      sourceOperationId: null,
      toolCallId: null,
    })
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValue({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-approval-1',
      type: 'approval',
      status: 'pending',
      operationId: 'create_image',
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
      operationId: 'create_image',
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
      operationId: 'create_image',
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
      operationId: 'create_image',
    }))
    expect(state.activeWaits.map((wait) => wait.operationId)).toEqual(['create_image'])
    expect(state.activeTasks).toEqual([{
      taskId: 'task-1',
      operationId: 'create_image',
      taskType: 'creative_resource_image',
      targetType: 'CreativeResource',
      targetId: 'resource-image-1',
      status: 'processing',
    }])
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: { not: TASK_TYPE.CREATIVE_WORK },
      }),
    }))
  })

  it('projects a project-scoped Creative Task through its episode-scoped origin Run', async () => {
    mockSessionTaskRows([], [{
      id: 'creative-task-project-scope',
      status: 'failed',
      payload: {
        protocol: 'creative_work_v11',
        requestKey: 'screenplay-drafting',
        request: {
          outputKind: 'screenplay',
          goal: 'Write the requested screenplay.',
          context: {
            userRequest: 'Produce this screenplay.',
            sourceMaterials: [],
            constraints: [],
          },
          creativeDirection: null,
          productionContext: { video: null },
        },
        modelKey: 'openrouter::anthropic/claude-fable-5',
        inputFingerprint: 'fingerprint-1',
        origin: { runId: 'run-1', toolCallId: 'tool-creative-1' },
        lifecycleProjection: {
          requestKey: 'screenplay-drafting',
          outputKind: 'screenplay',
          goal: 'Write the requested screenplay.',
          events: [{
            sequence: 1,
            occurredAt: '2026-07-23T00:00:00.000Z',
            event: {
              kind: 'started',
              outputKind: 'screenplay',
              goal: 'Write the requested screenplay.',
            },
          }],
        },
      },
      result: null,
      errorCode: 'INTERNAL_ERROR',
      finishedAt: new Date('2026-07-23T00:00:01.000Z'),
    }])

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.subagents).toEqual([expect.objectContaining({
      taskId: 'creative-task-project-scope',
      runId: 'run-1',
      status: 'failed',
      outputKind: 'screenplay',
      errorCode: 'INTERNAL_ERROR',
    })])
    const creativeTaskQuery = (prismaMock.task.findMany.mock.calls
      .map(([query]) => query)
      .find((query) => (
        query
        && typeof query === 'object'
        && 'where' in query
        && query.where
        && typeof query.where === 'object'
        && 'type' in query.where
        && query.where.type === TASK_TYPE.CREATIVE_WORK
      ))) as { where?: Record<string, unknown> } | undefined
    expect(creativeTaskQuery).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ payload: { path: '$.origin.runId', equals: 'run-1' } }],
      }),
    }))
    expect(creativeTaskQuery?.where).not.toHaveProperty('episodeId')
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
      operationId: 'create_image',
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
      operationId: 'create_image',
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
      operationId: 'create_image',
      sourceOperationId: null,
      toolCallId: null,
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
