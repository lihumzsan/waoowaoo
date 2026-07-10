import {
  approvalPost,
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

  it('POST /api/projects/[projectId]/assistant/chat -> rejects legacy full message payloads', async () => {
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'legacy' }] }],
          assistantPermissionMode: 'ask',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_MESSAGES_NOT_ACCEPTED' }),
      }),
    }))
  })

  it('POST /api/projects/[projectId]/assistant/runs/[runId]/approval -> rejects legacy full message payloads', async () => {
    const response = await approvalPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/runs/run-1/approval',
        method: 'POST',
        body: {
          messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'legacy' }] }],
          assistantPermissionMode: 'ask',
          interruptionId: 'interruption-1',
          approved: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', runId: 'run-1' }) },
    )

    expect(response.status).toBe(400)
    expect(projectAgentMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'PROJECT_AGENT_MESSAGES_NOT_ACCEPTED' }),
      }),
    }))
  })
})
