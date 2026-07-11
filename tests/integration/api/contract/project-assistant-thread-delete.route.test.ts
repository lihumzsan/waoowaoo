import {
  authState,
  beforeEach,
  buildMockRequest,
  chatDelete,
  compressionState,
  describe,
  expect,
  it,
  threadClearMock,
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
    expect(threadClearMock.clearProjectAssistantThread).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
    await expect(response.json()).resolves.toEqual({ success: true, eventWatermark: '42' })
  })

  it('DELETE /api/projects/[projectId]/assistant/chat -> rejects clearing while an assistant run is active', async () => {
    threadClearMock.clearProjectAssistantThread.mockRejectedValueOnce(
      new Error('PROJECT_AGENT_THREAD_ACTIVE:run-active'),
    )

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
    expect(threadClearMock.clearProjectAssistantThread).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_THREAD_ACTIVE' }),
      }),
    }))
  })
})
