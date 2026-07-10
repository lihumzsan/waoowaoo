import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY,
  authState,
  beforeEach,
  buildMockRequest,
  buildTextAttachment,
  chatPost,
  compressionState,
  describe,
  expect,
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

  it('POST /api/projects/[projectId]/assistant/chat -> accepts file-only user messages through attachment metadata', async () => {
    const attachment = buildTextAttachment()
    const metadata = {
      custom: {
        [PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY]: [attachment],
      },
    }

    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        body: {
          message: {
            id: 'u-file',
            role: 'user',
            parts: [{ type: 'text', text: '' }],
            metadata,
          },
          context: {
            episodeId: 'episode-1',
          },
          assistantPermissionMode: 'ask',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(runMock.createProjectAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      appendMessages: [{
        id: 'u-file',
        role: 'user',
        parts: [{ type: 'text', text: '' }],
        metadata,
      }],
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{
        id: 'u-file',
        role: 'user',
        parts: [{ type: 'text', text: '' }],
        metadata,
      }],
    }))
  })
})
