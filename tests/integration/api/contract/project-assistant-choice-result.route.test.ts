import {
  authState,
  beforeEach,
  buildMockRequest,
  chatPost,
  compressionState,
  describe,
  expect,
  it,
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
            interruptionId: null,
            choiceType: 'style',
            toolCallId: null,
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
        id: 'workspace-control-user:choice_response:run-1:style',
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
