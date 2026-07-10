import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

const prismaState = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  bibleFindFirst: vi.fn(),
  editScriptFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findFirst: prismaState.projectFindFirst,
    },
    projectEditBible: {
      findFirst: prismaState.bibleFindFirst,
    },
    projectEditScript: {
      findMany: prismaState.editScriptFindMany,
    },
  },
}))

vi.mock('@/lib/storage', () => ({
  getSignedUrl: (key: string) => `/signed/${key}`,
}))

import {
  buildEditFirstAssistantChoiceCard,
  readEditFirstAspectRatio,
} from '@/lib/project-agent/choice-card'
import { parseProjectAgentChoiceDecision } from '@/lib/project-agent/choice-offer'

function workflow(
  stage: EditFirstWorkflowState['stage'],
  nextAction: EditFirstWorkflowState['nextAction'] = null,
): EditFirstWorkflowState {
  return {
    active: true,
    stage,
    blocking: {
      kind: stage === 'needs_style_choice' || stage === 'assets_ready_for_review' ? 'needs_user_choice' : 'needs_confirmation',
      reason: null,
    },
    nextAction,
    allowedOperationIds: nextAction ? [nextAction.operationId] : [],
  }
}

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

  it('accepts only selections that were present in the persisted Choice Offer', () => {
    const offer = {
      schemaVersion: 1 as const,
      card: {
        cardId: 'style-card-1',
        runId: 'run-1',
        interruptionId: 'interruption-1',
        toolCallId: 'tool-1',
        choiceType: 'style' as const,
        title: 'Style',
        groups: [{
          key: 'stylePreviewId',
          label: 'Style',
          required: true,
          options: [{ value: 'preview-1', label: 'Preview 1' }],
        }],
        submitLabel: 'Continue',
        submit: { kind: 'submit_tool_output' as const },
      },
      reviewedResource: {
        kind: 'style_preview_set' as const,
        fingerprint: '0'.repeat(64),
      },
    }

    expect(parseProjectAgentChoiceDecision({
      offer,
      response: { ok: true, decision: 'select', selections: { stylePreviewId: 'preview-1' } },
      latestUserText: '',
    })).toEqual({ choiceType: 'style', decision: 'select', stylePreviewId: 'preview-1' })
    expect(() => parseProjectAgentChoiceDecision({
      offer,
      response: { ok: true, decision: 'select', selections: { stylePreviewId: 'preview-outside-offer' } },
      latestUserText: '',
    })).toThrow('PROJECT_AGENT_CHOICE_SELECTION_NOT_OFFERED:stylePreviewId:preview-outside-offer')
  })

  it('builds a bible review card after bible generation', async () => {
    prismaState.bibleFindFirst.mockResolvedValueOnce({
      id: 'bible-1',
      status: 'bible_ready_for_review',
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
      workflow: workflow('bible_ready_for_review'),
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
    })

    expect(card).toMatchObject({
      cardId: expect.stringMatching(/^edit-first-bible-review:[a-f0-9]{12}$/),
      toolCallId: 'tool-call-1',
      choiceType: 'bible_review',
      variant: 'confirm_or_reply',
      title: '确认制作规划',
      description: '请审核系统对整集剧本的理解、章节切分、长期事实和情绪走势，并选择项目画面比例。确认后，这份制作规划将作为各章节制作的基线。',
      groups: [{
        key: 'aspectRatio',
        label: '画面比例',
        required: true,
        options: [
          { value: '9:16', label: '9:16', description: '项目视频画面比例' },
          { value: '16:9', label: '16:9', description: '项目视频画面比例' },
          { value: '21:9', label: '21:9', description: '项目视频画面比例' },
        ],
      }],
      submitLabel: '确认制作规划',
      submit: {
        kind: 'submit_tool_output',
      },
      replyLabel: '需要修改',
      replyToolOutputKey: 'revisionNotes',
    })
    expect(card).not.toHaveProperty('operationPlan')
  })

  it('rejects bible review cards outside the bible review stage', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('ready_to_ingest_script'),
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
    })).rejects.toThrow('EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=bible_review:stage=ready_to_ingest_script')
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
      workflow: workflow('script_ready_for_review'),
      choiceType: 'script_review',
      toolCallId: 'tool-call-script',
    })

    expect(card).toMatchObject({
      cardId: expect.stringMatching(/^edit-first-script-review:episode-1:[a-f0-9]{12}$/),
      toolCallId: 'tool-call-script',
      choiceType: 'script_review',
      variant: 'confirm_or_reply',
      title: '确认剧本',
      groups: [],
      submitLabel: '确认剧本，生成制作规划',
      submit: {
        kind: 'submit_tool_output',
      },
      replyLabel: '需要修改',
      replyToolOutputKey: 'revisionNotes',
    })
  })

  it('rejects script review cards outside the script review stage', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('ready_to_generate_bible'),
      choiceType: 'script_review',
      toolCallId: 'tool-call-script',
    })).rejects.toThrow('EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=script_review:stage=ready_to_generate_bible')
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
      workflow: workflow('needs_style_choice'),
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
      groups: [
        {
          key: 'stylePreviewId',
          required: true,
        },
      ],
      submit: { kind: 'submit_tool_output' },
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
      workflow: workflow('needs_style_choice'),
      choiceType: 'style',
      toolCallId: 'tool-call-1',
    })

    expect(card.groups[0]?.options.map((option) => option.value)).toEqual(['style-a', 'style-b'])
    expect(card.groups[0]?.options).toHaveLength(2)
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
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          errorMessage: null,
        },
        {
          id: 'requirement-location-1',
          kind: 'location',
          name: '地下室',
          status: 'completed',
          targetId: 'location-1',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
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
      variant: 'confirm_or_reply',
      title: '审核分镜资产',
      groups: [{
        key: 'assetSummary',
        label: '已就绪资产',
        required: false,
        options: [{
          value: 'edit-script-1',
          label: '第 1 章 · 2 个资产',
          description: '老李 / character\n地下室 / location',
        }],
      }],
      submitLabel: '资产满意，继续',
      submit: {
        kind: 'submit_tool_output',
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
        updatedAt: new Date('2026-01-01T00:00:00Z'),
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
