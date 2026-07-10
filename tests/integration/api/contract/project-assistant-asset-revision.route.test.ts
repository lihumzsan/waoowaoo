import {
  authState,
  beforeEach,
  buildMockRequest,
  chatPost,
  compressionState,
  describe,
  editScriptServiceMock,
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

  it('POST /api/projects/[projectId]/assistant/chat -> keeps assets unapproved when asset review sends revision notes', async () => {
    mockConsumedChoice({
      choiceType: 'asset_review',
      interruptionId: 'choice-asset-2',
      cardId: 'asset-card-2',
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
          visibleUserText: '场景太现代',
          control: {
            type: 'choice_response',
            runId: 'run-1',
            interruptionId: 'choice-asset-2',
            cardId: 'asset-card-2',
            toolCallId: 'tool-choice-asset',
            output: {
              ok: true,
              decision: 'revise',
              revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
            },
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(editScriptServiceMock.approveProjectEpisodeEditScriptAssets).not.toHaveBeenCalled()
    const createResponseMock = projectAgentMock.createProjectAgentChatResponse as unknown as {
      mock: {
        calls: Array<[unknown]>
      }
    }
    const callInput = createResponseMock.mock.calls[0]?.[0] as {
      control?: {
        choiceResult?: {
          inputItems?: Array<Record<string, unknown>>
        }
      }
    } | undefined
    const resultItem = callInput?.control?.choiceResult?.inputItems?.find((item) => item.type === 'function_call_result')
    const output = resultItem?.output as { text?: string } | undefined
    expect(output?.text ? JSON.parse(output.text) as Record<string, unknown> : null).toMatchObject({
      choiceType: 'asset_review',
      decision: 'revise',
      revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
    })
  })
})
