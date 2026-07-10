import {
  authState,
  beforeEach,
  buildMockRequest,
  chatPost,
  compressionState,
  describe,
  expect,
  it,
  projectAgentMock,
  vi,
  waitMock,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> consumes a claimed wait follow-up exactly once', async () => {
    waitMock.consumeProjectAgentWaitFollowUp.mockResolvedValueOnce({
      runId: 'run-1',
      waitId: 'wait-1',
      followUpKey: 'project-agent-wait:wait-1:completed',
      operationId: 'generate_edit_script',
      taskIds: ['task-1'],
      failedTaskIds: [],
      failedTasks: [],
      terminalStatus: 'completed',
      total: 1,
      successCount: 1,
      failedCount: 0,
      claimId: 'claim-1',
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
            type: 'task_follow_up',
            runId: 'run-1',
            waitId: 'wait-1',
            claimId: 'claim-1',
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(waitMock.consumeProjectAgentWaitFollowUp).toHaveBeenCalledWith({
      runId: 'run-1',
      waitId: 'wait-1',
      claimId: 'claim-1',
      projectId: 'project-1',
      userId: 'user-1',
    })
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'task_follow_up',
        followUp: expect.objectContaining({ waitId: 'wait-1' }),
      }),
    }))
  })
})
