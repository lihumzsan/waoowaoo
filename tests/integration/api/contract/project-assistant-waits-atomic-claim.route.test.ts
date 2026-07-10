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
  waitsPost,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/waits -> atomically claims one follow-up before client wake-up', async () => {
    waitMock.claimResolvedProjectAgentWaitFollowUps.mockResolvedValueOnce([{
      waitId: 'wait-1',
      followUpKey: 'project-agent-wait:wait-1:failed',
      operationId: 'generate_edit_script',
      taskIds: ['task-1', 'task-2'],
      failedTaskIds: ['task-2'],
      failedTasks: [{
        taskId: 'task-2',
        taskType: 'video_group',
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        status: 'failed',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'output video may be related to copyright restrictions',
      }],
      terminalStatus: 'failed',
      total: 2,
      successCount: 1,
      failedCount: 1,
      claimId: 'claim-1',
    }])

    const response = await waitsPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/waits',
        method: 'POST',
        body: {
          action: 'claim',
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(waitMock.claimResolvedProjectAgentWaitFollowUps).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      limit: 1,
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      followUps: [{
        waitId: 'wait-1',
        followUpKey: 'project-agent-wait:wait-1:failed',
        operationId: 'generate_edit_script',
        taskIds: ['task-1', 'task-2'],
        failedTaskIds: ['task-2'],
        failedTasks: [{
          taskId: 'task-2',
          taskType: 'video_group',
          targetType: 'ProjectVideoGroup',
          targetId: 'group-1',
          status: 'failed',
          errorCode: 'INTERNAL_ERROR',
          errorMessage: 'output video may be related to copyright restrictions',
        }],
        terminalStatus: 'failed',
        total: 2,
        successCount: 1,
        failedCount: 1,
        claimId: 'claim-1',
      }],
    })
  })
})
