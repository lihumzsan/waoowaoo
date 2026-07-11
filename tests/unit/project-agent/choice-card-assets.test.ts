import {
  beforeEach,
  buildEditFirstAssistantChoiceCard,
  describe,
  expect,
  it,
  prismaState,
  vi,
  workflow,
} from './choice-card.fixture'

describe('edit-first assistant choice cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaState.projectFindFirst.mockReset()
    prismaState.bibleFindFirst.mockReset()
    prismaState.editScriptFindMany.mockReset()
  })

  it('rejects style cards while style previews are still generating', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('style_preview_generating'),
      choiceType: 'style',
      toolCallId: 'tool-call-1',
    })).rejects.toThrow('EDIT_FIRST_STYLE_PREVIEW_NOT_READY:stage=style_preview_generating')
  })

  it('builds an asset review card with revision notes after required assets are ready', async () => {
    prismaState.editScriptFindMany.mockResolvedValueOnce([{
      id: 'edit-script-1',
      chapterId: 'chapter-1',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      requirements: [
        {
          id: 'requirement-character-1',
          kind: 'character',
          name: '老李',
          status: 'completed',
          targetId: 'character-1',
          errorMessage: null,
        },
        {
          id: 'requirement-location-1',
          kind: 'location',
          name: '地下室',
          status: 'completed',
          targetId: 'location-1',
          errorMessage: null,
        },
      ],
    }])

    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('assets_ready_for_review'),
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
    })

    expect(card).toMatchObject({
      cardId: expect.stringMatching(/^edit-first-asset-review:episode-1:[a-f0-9]{12}$/),
      toolCallId: 'tool-call-1',
      choiceType: 'asset_review',
      replyMode: 'whole_card',
      variant: 'confirm_or_reply',
      title: '审核分镜资产',
      groups: [{
        key: 'assetSummary',
        label: '已就绪资产',
        required: false,
        presentation: 'options',
        options: [{
          value: 'edit-script-1',
          label: '第 1 章 · 2 个资产',
          description: '老李 / character\n地下室 / location',
        }],
      }],
      submitLabel: '资产满意，继续',
      submit: {
        kind: 'submit_tool_output',
        decision: 'approve',
      },
      replyLabel: '需要调整',
      replyPlaceholder: '输入你希望调整的人物、场景、空间关系或视觉问题...',
      replySubmitLabel: '提交调整意见',
      replyToolOutputKey: 'revisionNotes',
    })
  })

  it('rejects asset review cards before every chapter asset is completed', async () => {
    prismaState.editScriptFindMany.mockResolvedValueOnce([{
      id: 'edit-script-1',
      chapterId: 'chapter-1',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      requirements: [{
        id: 'requirement-location-1',
        kind: 'location',
        name: '地下室',
        status: 'generating',
        targetId: null,
        errorMessage: null,
      }],
    }])

    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('assets_ready_for_review'),
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
    })).rejects.toThrow('EDIT_FIRST_ASSET_REVIEW_ASSETS_NOT_READY:chapter-1:地下室:generating')
  })

  it('rejects asset review cards outside the asset review stage', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('ready_to_generate_shot_execution_plan'),
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
    })).rejects.toThrow('EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=asset_review:stage=ready_to_generate_shot_execution_plan')
  })
})
