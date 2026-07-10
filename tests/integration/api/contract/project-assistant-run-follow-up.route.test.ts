import {
  authState,
  beforeEach,
  buildMockRequest,
  compressionState,
  describe,
  expect,
  it,
  projectAgentMock,
  taskFollowUpPost,
  vi,
  waitMock,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/runs/[runId]/task-follow-up -> consumes wait follow-up through the run-scoped endpoint', async () => {
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

    const response = await taskFollowUpPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/runs/run-1/task-follow-up',
        method: 'POST',
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          waitId: 'wait-1',
          claimId: 'claim-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', runId: 'run-1' }) },
    )

    expect(response.status).toBe(200)
    expect(waitMock.consumeProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      waitId: 'wait-1',
      claimId: 'claim-1',
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'task_follow_up',
      }),
    }))
  })
})
