import {
  authState,
  beforeEach,
  buildMockRequest,
  compressionState,
  describe,
  expect,
  interruptionMock,
  it,
  runGet,
  runMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('GET /api/projects/[projectId]/assistant/runs/[runId] -> returns the server-side run status', async () => {
    runMock.getProjectAgentRun.mockResolvedValueOnce({
      id: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-1',
      status: 'running',
      controlKind: 'approval_response',
    })
    interruptionMock.getPendingProjectAgentApprovalInterruption.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      type: 'approval',
      status: 'pending',
      operationId: 'generate_edit_shot_execution_plan',
      approvalId: 'approval-1',
      toolCallId: 'tool-call-1',
    })

    const response = await runGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/runs/run-1?episodeId=episode-1',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1', runId: 'run-1' }) },
    )

    expect(response.status).toBe(200)
    expect(runMock.getProjectAgentRun).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      episodeId: 'episode-1',
      runId: 'run-1',
    })
    expect(interruptionMock.getPendingProjectAgentApprovalInterruption).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      episodeId: 'episode-1',
      runId: 'run-1',
    })
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      success: true,
      run: expect.objectContaining({
        id: 'run-1',
        status: 'running',
        controlKind: 'approval_response',
      }),
      pendingApproval: {
        interruptionId: 'interruption-1',
        approvalId: 'approval-1',
        operationId: 'generate_edit_shot_execution_plan',
        toolCallId: 'tool-call-1',
      },
    }))
  })
})
