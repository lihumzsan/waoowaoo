import {
  beforeEach,
  buildEditFirstAssistantChoiceCard,
  describe,
  expect,
  it,
  prismaState,
  readEditFirstAspectRatio,
  vi,
} from './choice-card.fixture'

describe('edit-first assistant choice cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaState.projectFindFirst.mockReset()
    prismaState.bibleFindFirst.mockReset()
    prismaState.editScriptFindMany.mockReset()
  })

  it('detects explicit aspect ratio in user text', () => {
    expect(readEditFirstAspectRatio('我选择 16:9')).toBe('16:9')
    expect(readEditFirstAspectRatio('继续')).toBeNull()
  })

  it('builds a bible review card after bible generation', async () => {
    prismaState.bibleFindFirst.mockResolvedValueOnce({
      id: 'bible-1',
      status: 'ready_for_review',
      version: 2,
      bibleJson: { logline: 'story' },
      beatSheetJson: { beats: [] },
      ledgerJson: { facts: [] },
      emotionalCurveJson: { points: [] },
      styleBibleJson: null,
      diagnosticsJson: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      sourceDocument: {
        id: 'source-1',
        checksum: 'checksum-1',
        version: 1,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    })
    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
    })

    expect(card).toMatchObject({
      cardId: expect.stringMatching(/^edit-first-bible-review:[a-f0-9]{12}$/),
      toolCallId: 'tool-call-1',
      choiceType: 'bible_review',
      replyMode: 'whole_card',
      variant: 'confirm_or_reply',
      title: '确认制作规划',
      description: '请审核系统对整集剧本的理解、章节切分、长期事实和情绪走势，并选择项目画面比例。确认后，这份制作规划将作为各章节制作的基线。',
      groups: [{
        key: 'aspectRatio',
        label: '画面比例',
        required: true,
        presentation: 'aspect_ratio',
        options: [
          { value: '9:16', label: '9:16', description: '项目视频画面比例' },
          { value: '16:9', label: '16:9', description: '项目视频画面比例' },
          { value: '21:9', label: '21:9', description: '项目视频画面比例' },
        ],
      }],
      submitLabel: '确认制作规划',
      submit: {
        kind: 'submit_tool_output',
        decision: 'approve',
      },
      replyLabel: '需要修改',
      replyToolOutputKey: 'revisionNotes',
    })
    expect(card).not.toHaveProperty('operationPlan')
  })

  it('rejects bible review when no reviewable plan exists', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
    })).rejects.toThrow('EDIT_FIRST_CHOICE_BIBLE_NOT_FOUND')
  })

  it('builds a script review card after prompt script expansion', async () => {
    prismaState.bibleFindFirst.mockResolvedValueOnce({
      id: 'bible-1',
      status: 'script_ready_for_review',
      version: 2,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      sourceDocument: {
        id: 'source-script',
        sourceKind: 'prompt_generated_script',
        checksum: 'checksum-script',
        version: 3,
        normalizedText: '扩写后的完整剧本正文',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    })

    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      choiceType: 'script_review',
      toolCallId: 'tool-call-script',
    })

    expect(card).toMatchObject({
      cardId: expect.stringMatching(/^edit-first-script-review:episode-1:[a-f0-9]{12}$/),
      toolCallId: 'tool-call-script',
      choiceType: 'script_review',
      replyMode: 'whole_card',
      variant: 'confirm_or_reply',
      title: '确认剧本',
      groups: [],
      submitLabel: '确认剧本，生成制作规划',
      submit: {
        kind: 'submit_tool_output',
        decision: 'approve',
      },
      replyLabel: '需要修改',
      replyToolOutputKey: 'revisionNotes',
    })
  })

  it('rejects script review when no reviewable generated script exists', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      choiceType: 'script_review',
      toolCallId: 'tool-call-script',
    })).rejects.toThrow('EDIT_FIRST_CHOICE_SCRIPT_NOT_FOUND')
  })

  it('builds a style card from the available completed style previews', async () => {
    prismaState.projectFindFirst.mockResolvedValueOnce({
      id: 'project-1',
      videoRatio: '16:9',
    })
    prismaState.bibleFindFirst.mockResolvedValueOnce({
      id: 'bible-1',
      status: 'confirmed',
      version: 2,
      stylePreviews: [
        {
          id: 'style-a',
          styleKey: 'A',
          title: '硬核写实科幻风格',
          summary: '高精度数字化质感。',
          imageKey: 'a.png',
          status: 'completed',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'style-b',
          styleKey: 'B',
          title: '史诗胶片宽银幕风格',
          summary: '浓郁胶片颗粒。',
          imageKey: 'b.png',
          status: 'completed',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'style-c',
          styleKey: 'C',
          title: '极简克制艺术风格',
          summary: '低反差极简画面。',
          imageKey: null,
          status: 'completed',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    })

    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      choiceType: 'style',
      toolCallId: 'tool-call-1',
    })

    expect(prismaState.bibleFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        episodeId: 'episode-1',
        episode: expect.objectContaining({
          projectId: 'project-1',
          project: expect.objectContaining({
            userId: 'user-1',
          }),
        }),
      }),
    }))
    expect(card).toMatchObject({
      cardId: 'edit-first-style:bible-1',
      toolCallId: 'tool-call-1',
      choiceType: 'style',
      replyMode: 'whole_card',
      groups: [
        {
          key: 'stylePreviewId',
          required: true,
          presentation: 'image',
        },
      ],
      submit: { kind: 'submit_tool_output', decision: 'select' },
    })
    expect(card.groups[0]?.options.map((option) => option.value)).toEqual(['style-a', 'style-b', 'style-c'])
    expect(card.groups[0]?.options[0]?.imageUrl).toBe('/signed/a.png')
    expect(card.groups).toHaveLength(1)
  })

  it('renders style card options from the actual completed preview count', async () => {
    prismaState.projectFindFirst.mockResolvedValueOnce({
      id: 'project-1',
      videoRatio: '16:9',
    })
    prismaState.bibleFindFirst.mockResolvedValueOnce({
      id: 'bible-1',
      status: 'confirmed',
      version: 2,
      stylePreviews: [
        {
          id: 'style-a',
          styleKey: 'A',
          title: '暗黑手绘插画',
          summary: '更黑暗。',
          imageKey: 'a.png',
          status: 'completed',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'style-b',
          styleKey: 'B',
          title: '黑白插画',
          summary: '更克制。',
          imageKey: 'b.png',
          status: 'completed',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    })

    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      choiceType: 'style',
      toolCallId: 'tool-call-1',
    })

    expect(card.groups[0]?.options.map((option) => option.value)).toEqual(['style-a', 'style-b'])
    expect(card.groups[0]?.options).toHaveLength(2)
  })

  it('builds one episode-level asset confirmation without chapter selection options', async () => {
    prismaState.editScriptFindMany.mockResolvedValueOnce([
      {
        id: 'script-1',
        chapterId: 'chapter-1',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        requirements: [{
          id: 'requirement-1',
          kind: 'character',
          name: 'Character',
          status: 'completed',
          targetId: 'character-1',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          errorMessage: null,
        }],
      },
      {
        id: 'script-2',
        chapterId: 'chapter-2',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        requirements: [{
          id: 'requirement-2',
          kind: 'character',
          name: 'Character',
          status: 'completed',
          targetId: 'character-1',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          errorMessage: null,
        }],
      },
    ])

    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      choiceType: 'asset_review',
      toolCallId: 'tool-call-assets',
    })

    expect(card).toMatchObject({
      choiceType: 'asset_review',
      groups: [],
      submitLabel: '资产满意，继续',
      submit: { kind: 'submit_tool_output', decision: 'approve' },
    })
  })
})
