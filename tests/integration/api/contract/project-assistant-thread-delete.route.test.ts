import {
  authState,
  beforeEach,
  buildMockRequest,
  chatDelete,
  compressionState,
  describe,
  expect,
  it,
  persistenceMock,
  runMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('DELETE /api/projects/[projectId]/assistant/chat -> clears workspace thread from database service', async () => {
    const response = await chatDelete(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'DELETE',
        query: {
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(persistenceMock.clearProjectAssistantThread).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
  })

  it('DELETE /api/projects/[projectId]/assistant/chat -> rejects clearing while an assistant run is active', async () => {
    runMock.listBlockingProjectAgentRunsForThreadClear.mockResolvedValueOnce([{
      id: 'run-active',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-1',
      status: 'running',
      controlKind: 'user_turn',
      heartbeatAt: new Date('2026-07-03T00:00:00.000Z'),
    }])

    const response = await chatDelete(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'DELETE',
        query: {
          episodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(409)
    expect(persistenceMock.clearProjectAssistantThread).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_THREAD_ACTIVE' }),
      }),
    }))
  })
})
