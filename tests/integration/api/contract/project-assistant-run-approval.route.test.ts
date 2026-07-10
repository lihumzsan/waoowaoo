import {
  approvalPost,
  authState,
  beforeEach,
  buildMockRequest,
  compressionState,
  describe,
  expect,
  interruptionMock,
  it,
  projectAgentMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/runs/[runId]/approval -> consumes approval through the run-scoped endpoint', async () => {
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

    const response = await approvalPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/runs/run-1/approval',
        method: 'POST',
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          interruptionId: 'interruption-1',
          approved: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', runId: 'run-1' }) },
    )

    expect(response.status).toBe(200)
    expect(interruptionMock.consumeProjectAgentApprovalInterruption).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      interruptionId: 'interruption-1',
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'approval',
        approved: true,
      }),
    }))
  })
})
