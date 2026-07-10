import {
  authState,
  beforeEach,
  buildMockRequest,
  chatPost,
  compressionState,
  describe,
  expect,
  interruptionMock,
  it,
  persistenceMock,
  projectAgentMock,
  runLockMock,
  runMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> forwards request to project agent runtime', async () => {
    persistenceMock.loadProjectAssistantThread.mockResolvedValueOnce({
      id: 'thread-1',
      assistantId: 'workspace-command',
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeRef: 'episode:episode-1',
      messages: [{
        id: 'assistant-existing',
        role: 'assistant',
        parts: [{ type: 'text', text: '已有上下文' }],
      }],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    })

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          message: {
            id: 'u1',
            role: 'user',
            parts: [{ type: 'text', text: '运行故事到剧本' }],
          },
          context: {
            episodeId: 'episode-1',
            selectedScopeRef: 'panel:panel-1',
            selectedPanelId: 'panel-1',
            selectedAssetId: 'asset-1',
          },
          assistantPermissionMode: 'ask',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledTimes(1)
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        selectedScopeRef: 'panel:panel-1',
        selectedPanelId: 'panel-1',
        selectedAssetId: 'asset-1',
      },
      assistantPermissionMode: 'ask',
    }))
    expect(runLockMock.acquireProjectAgentRunLock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      runId: expect.any(String),
    })
    const acquireCallOrder = runLockMock.acquireProjectAgentRunLock.mock.invocationCallOrder[0]
    const loadThreadCallOrder = persistenceMock.loadProjectAssistantThread.mock.invocationCallOrder[0]
    expect(acquireCallOrder).toBeLessThan(loadThreadCallOrder)
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      runLock: { key: 'lock-key', token: 'lock-token', runId: expect.any(String) },
      control: { kind: 'user_turn', declinedInterruptions: [] },
      messages: [
        {
          id: 'assistant-existing',
          role: 'assistant',
          parts: [{ type: 'text', text: '已有上下文' }],
        },
        {
          id: 'u1',
          role: 'user',
          parts: [{ type: 'text', text: '运行故事到剧本' }],
        },
      ],
    }))
    expect(runMock.createProjectAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      appendMessages: [{
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: '运行故事到剧本' }],
      }],
    }))
    expect(interruptionMock.declinePendingProjectAgentInterruptionsForUserTurn).toHaveBeenCalledTimes(1)
  })
})
