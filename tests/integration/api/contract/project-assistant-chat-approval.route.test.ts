import {
  authState,
  beforeEach,
  buildMockRequest,
  chatPost,
  compressionState,
  describe,
  expect,
  interruptionMock,
  it,
  projectAgentMock,
  runMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> consumes a pending approval interruption via structured control', async () => {
    interruptionMock.consumeProjectAgentApprovalInterruption.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      type: 'approval',
      status: 'consumed',
      operationId: 'ingest_script',
      approvalId: 'approval-1',
      toolCallId: 'call-1',
      runState: 'serialized-state',
    })

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          visibleUserText: '民俗恐怖片',
          control: {
            type: 'approval_response',
            runId: 'run-1',
            interruptionId: 'interruption-1',
            approved: true,
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(interruptionMock.consumeProjectAgentApprovalInterruption).toHaveBeenCalledWith(expect.objectContaining({
      interruptionId: 'interruption-1',
      runId: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      response: { approved: true, reason: null },
    }))
    expect(runMock.updateProjectAgentRunStatus).not.toHaveBeenCalled()
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'approval',
        approved: true,
        interruption: expect.objectContaining({ id: 'interruption-1', runState: 'serialized-state' }),
      }),
    }))
  })

  it('retries an already consumed approval only by creating a new Run attempt', async () => {
    runMock.getProjectAgentRun.mockResolvedValueOnce({
      id: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-1',
      status: 'failed',
      runVersion: 1,
      eventSeq: '4',
      terminalEventSeq: '4',
      controlKind: 'approval_response',
      stopReason: 'control_resolution_failed',
      errorCode: 'PROJECT_AGENT_CONTROL_FAILED',
      heartbeatAt: new Date('2026-07-03T00:00:00.000Z'),
    })
    interruptionMock.consumeProjectAgentApprovalInterruption.mockResolvedValueOnce(null)
    interruptionMock.readRetryableConsumedProjectAgentApprovalInterruption.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      type: 'approval',
      status: 'consumed',
      operationId: 'ingest_script',
      approvalId: 'approval-1',
      toolCallId: 'call-1',
      runState: 'serialized-state',
    })

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: {
            type: 'approval_response',
            runId: 'run-1',
            interruptionId: 'interruption-1',
            approved: true,
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(runMock.createProjectAgentConsumedControlRetryRun).toHaveBeenCalledWith(expect.objectContaining({
      interruptionId: 'interruption-1',
      controlKind: 'approval_response',
      runId: expect.not.stringMatching(/^run-1$/),
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      run: expect.objectContaining({ id: 'run-retry-1' }),
      control: expect.objectContaining({
        kind: 'approval',
        interruption: expect.objectContaining({ status: 'consumed' }),
      }),
    }))
  })

  it('returns conflict instead of replaying after execution outcome becomes unknown', async () => {
    runMock.getProjectAgentRun.mockResolvedValueOnce({
      id: 'run-1',
      status: 'failed',
      errorCode: 'PROJECT_AGENT_CONTROL_FAILED',
    })
    interruptionMock.consumeProjectAgentApprovalInterruption.mockResolvedValueOnce(null)
    interruptionMock.readRetryableConsumedProjectAgentApprovalInterruption.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      type: 'approval',
      status: 'consumed',
      operationId: 'ingest_script',
      approvalId: 'approval-1',
      toolCallId: 'call-1',
      runState: 'serialized-state',
    })
    runMock.createProjectAgentConsumedControlRetryRun.mockRejectedValueOnce(
      new Error('PROJECT_AGENT_CONTROL_EXECUTION_OUTCOME_UNKNOWN:run-1'),
    )

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          control: {
            type: 'approval_response',
            runId: 'run-1',
            interruptionId: 'interruption-1',
            approved: true,
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(409)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({
          code: 'PROJECT_AGENT_CONTROL_EXECUTION_OUTCOME_UNKNOWN',
        }),
      }),
    }))
  })
})
