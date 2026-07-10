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
  runLockMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects concurrent runs in the same assistant scope', async () => {
    runLockMock.acquireProjectAgentRunLock.mockResolvedValueOnce(null)

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          message: {
            id: 'u1',
            role: 'user',
            parts: [{ type: 'text', text: '继续' }],
          },
          context: {
            episodeId: 'episode-1',
          },
          assistantPermissionMode: 'auto',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(409)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'CONFLICT',
        details: expect.objectContaining({
          code: 'PROJECT_AGENT_RUN_ACTIVE',
        }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects unauthenticated requests', async () => {
    authState.authenticated = false
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(401)
  })
})
