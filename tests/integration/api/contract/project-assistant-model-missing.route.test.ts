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
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> maps missing assistant model config into API error payloads', async () => {
    projectAgentMock.createProjectAgentChatResponse.mockRejectedValueOnce(
      new Error('PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED'),
    )

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
          assistantPermissionMode: 'ask',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'MISSING_CONFIG',
        details: expect.objectContaining({ code: 'PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED' }),
      }),
    }))
  })
})
