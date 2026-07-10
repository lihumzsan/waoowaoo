import {
  authState,
  beforeEach,
  buildMockRequest,
  chatPost,
  compressionState,
  describe,
  expect,
  it,
  mockConsumedChoice,
  persistenceMock,
  projectAgentMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> resolves a choice response into an in-band choice result', async () => {
    mockConsumedChoice({
      choiceType: 'style',
      interruptionId: 'choice-style-1',
      cardId: 'style-card-1',
      toolCallId: 'choice-tool-1',
    })
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          visibleUserText: '民俗恐怖片',
          control: {
            type: 'choice_response',
            runId: 'run-1',
            interruptionId: 'choice-style-1',
            cardId: 'style-card-1',
            toolCallId: 'choice-tool-1',
            output: {
              ok: true,
              stylePreviewId: 'style-1',
              aspectRatio: '9:16',
            },
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(persistenceMock.appendProjectAssistantThreadMessages).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({
        id: 'workspace-control-user:choice_response:run-1:choice-style-1',
        role: 'user',
        parts: [{ type: 'text', text: '民俗恐怖片' }],
      })],
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'choice',
        choiceType: 'style',
        choiceResult: expect.objectContaining({
          inputItems: expect.any(Array) as unknown[],
        }),
      }),
    }))
  })
})
