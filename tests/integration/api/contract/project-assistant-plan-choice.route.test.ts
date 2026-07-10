import {
  authState,
  beforeEach,
  buildMockRequest,
  choicePost,
  compressionState,
  describe,
  expect,
  it,
  interruptionMock,
  mockConsumedChoice,
  prismaMock,
  projectAgentMock,
  vi,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/runs/[runId]/choice -> confirms only the production plan and aspect ratio', async () => {
    mockConsumedChoice({
      choiceType: 'bible_review',
      interruptionId: 'choice-interruption-1',
      cardId: 'edit-first-bible-review:plan-1',
      toolCallId: 'tool-choice-1',
    })

    const response = await choicePost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/runs/run-1/choice',
        method: 'POST',
        body: {
          context: { episodeId: 'episode-1' },
          assistantPermissionMode: 'ask',
          visibleUserText: '鬼故事',
          interruptionId: 'choice-interruption-1',
          cardId: 'edit-first-bible-review:plan-1',
          toolCallId: 'tool-choice-1',
          output: {
            ok: true,
            decision: 'approve',
            selections: {
              aspectRatio: '9:16',
            },
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', runId: 'run-1' }) },
    )

    expect(response.status).toBe(200)
    expect(interruptionMock.consumeProjectAgentChoiceInterruption).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      interruptionId: 'choice-interruption-1',
    }))
    expect(projectAgentMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({
        kind: 'choice',
        choiceType: 'bible_review',
      }),
    }))
    expect(prismaMock.project.updateMany).not.toHaveBeenCalled()
  })
})
