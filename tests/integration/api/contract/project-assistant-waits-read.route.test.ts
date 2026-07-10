import {
  authState,
  beforeEach,
  buildMockRequest,
  compressionState,
  describe,
  expect,
  it,
  vi,
  waitMock,
  waitsGet,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('GET /api/projects/[projectId]/assistant/waits -> returns resolved follow-ups for the assistant scope', async () => {
    waitMock.listResolvedProjectAgentWaitFollowUps.mockResolvedValueOnce([{
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
      claimId: '',
    }])

    const response = await waitsGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/waits?episodeId=episode-1',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(waitMock.listResolvedProjectAgentWaitFollowUps).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      followUps: [{
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
        claimId: '',
      }],
    })
  })
})
