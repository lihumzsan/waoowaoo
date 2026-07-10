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

  it('POST /api/projects/[projectId]/assistant/chat -> rejects the retired public task follow-up control protocol', async () => {
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

    expect(response.status).toBe(400)
    expect(waitMock.consumeProjectAgentWaitFollowUp).not.toHaveBeenCalled()
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
  })
})
