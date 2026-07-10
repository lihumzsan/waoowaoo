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
  projectAgentMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/chat -> records asset approval without writing asset state', async () => {
    mockConsumedChoice({
      choiceType: 'asset_review',
      interruptionId: 'choice-asset-1',
      cardId: 'asset-card-1',
      toolCallId: 'tool-choice-asset',
    })
    const response = await chatPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/chat',
        method: 'POST',
        headers: { 'x-project-agent-run-control': '1' },
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          visibleUserText: '资产满意',
          control: {
            type: 'choice_response',
            runId: 'run-1',
            interruptionId: 'choice-asset-1',
            cardId: 'asset-card-1',
            toolCallId: 'tool-choice-asset',
            output: {
              ok: true,
              decision: 'approve',
            },
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'choice',
        choiceType: 'asset_review',
        choiceResult: expect.objectContaining({
          inputItems: expect.any(Array) as unknown[],
        }),
      }),
    }))
  })
})
