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
  projectAgentMock,
  runMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects a stale approval response with a conflict', async () => {
    interruptionMock.consumeProjectAgentApprovalInterruption.mockResolvedValueOnce(null)

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          visibleUserText: '场景太现代',
          control: {
            type: 'approval_response',
            runId: 'run-1',
            interruptionId: 'interruption-stale',
            approved: true,
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(409)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    expect(runMock.updateProjectAgentRunStatus).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_INTERRUPTION_NOT_PENDING' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects a repeated choice without reviving the run', async () => {
    interruptionMock.consumeProjectAgentChoiceInterruption.mockResolvedValueOnce(null)

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          visibleUserText: '选择第一个方案',
          control: {
            type: 'choice_response',
            runId: 'run-1',
            interruptionId: 'choice-already-consumed',
            cardId: 'style-card-1',
            toolCallId: 'choice-tool-1',
            output: {
              ok: true,
              stylePreviewId: 'style-1',
            },
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(409)
    expect(runMock.updateProjectAgentRunStatus).not.toHaveBeenCalled()
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_CHOICE_INTERRUPTION_NOT_PENDING' }),
      }),
    }))
  })
})
