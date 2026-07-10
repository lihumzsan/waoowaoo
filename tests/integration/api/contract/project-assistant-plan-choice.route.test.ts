import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  authState,
  beforeEach,
  buildMockRequest,
  choicePost,
  compressionState,
  describe,
  expect,
  interruptionMock,
  it,
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
    interruptionMock.consumeProjectAgentChoiceInterruption.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-1',
      type: 'choice',
      status: 'consumed',
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
      toolCallId: 'tool-choice-1',
      payload: {
        choiceType: 'bible_review',
        card: {
          cardId: 'edit-first-bible-review',
          toolCallId: 'tool-choice-1',
          choiceType: 'bible_review',
          title: 'Confirm production plan',
          groups: [{
            key: 'aspectRatio',
            label: 'Aspect Ratio',
            required: true,
            options: [],
          }],
          submitLabel: 'Confirm production plan',
          submit: { kind: 'submit_tool_output' },
        },
      },
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
          choiceType: 'bible_review',
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
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'user-1',
      },
      data: {
        videoRatio: '9:16',
      },
    })
  })
})
