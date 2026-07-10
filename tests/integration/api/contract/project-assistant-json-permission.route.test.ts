import {
  NextRequest,
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

  it('POST /api/projects/[projectId]/assistant/chat -> validates JSON body', async () => {
    const request = new NextRequest(new URL('http://localhost:3000/api/projects/project-1/assistant/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    const response = await chatPost(
      request,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'INVALID_PARAMS',
        details: expect.objectContaining({ code: 'BODY_PARSE_FAILED' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/chat -> rejects missing assistant permission mode', async () => {
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'INVALID_PARAMS',
        details: expect.objectContaining({ code: 'PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_REQUIRED' }),
      }),
    }))
  })
})
