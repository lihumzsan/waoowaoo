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
    // approval resume must not touch the user-turn decline path or history inference
    expect(interruptionMock.declinePendingProjectAgentInterruptionsForUserTurn).not.toHaveBeenCalled()
  })
})
