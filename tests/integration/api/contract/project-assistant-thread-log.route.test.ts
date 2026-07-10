import {
  authState,
  beforeEach,
  buildMockRequest,
  chatLogGet,
  compressionState,
  describe,
  expect,
  it,
  persistenceMock,
  threadLogMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('GET /api/projects/[projectId]/assistant/chat/log -> downloads current workspace thread log', async () => {
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

    const response = await chatLogGet(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat/log',
        method: 'GET',
        query: {
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(threadLogMock.serializeWorkspaceAssistantThreadLog).toHaveBeenCalledTimes(1)
    expect(response.headers.get('content-disposition')).toContain('workspace-assistant__project-1__episode_episode-1__thread-1.log')
  })
})
