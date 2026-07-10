import {
  authState,
  beforeEach,
  buildMockRequest,
  chatGet,
  compressionState,
  describe,
  expect,
  it,
  persistenceMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('GET /api/projects/[projectId]/assistant/chat -> loads persisted workspace thread from database service', async () => {
    persistenceMock.loadProjectAssistantThread.mockResolvedValueOnce({
      id: 'thread-1',
      assistantId: 'workspace-command',
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeRef: 'episode:episode-1',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'persisted' }],
        },
      ],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    })

    const response = await chatGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'GET',
        query: {
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(persistenceMock.loadProjectAssistantThread).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    await expect(response.json()).resolves.toEqual({
      thread: expect.objectContaining({
        id: 'thread-1',
        scopeRef: 'episode:episode-1',
      }),
    })
  })

  it('GET /api/projects/[projectId]/assistant/chat -> rejects unauthenticated requests', async () => {
    authState.authenticated = false
    const response = await chatGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(401)
  })
})
