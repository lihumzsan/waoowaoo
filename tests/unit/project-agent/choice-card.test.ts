import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

const prismaState = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  screenplayFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findFirst: prismaState.projectFindFirst,
    },
    projectEditScreenplay: {
      findFirst: prismaState.screenplayFindFirst,
    },
  },
}))

vi.mock('@/lib/storage', () => ({
  getSignedUrl: (key: string) => `/signed/${key}`,
}))

import {
  buildEditFirstAssistantChoiceCard,
  editFirstUserTextHasDuration,
  readEditFirstAspectRatio,
  readEditFirstDurationTier,
} from '@/lib/project-agent/choice-card'

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
    prismaState.screenplayFindFirst.mockReset()
  })

  it('detects explicit duration in user text', () => {
    expect(editFirstUserTextHasDuration('我选择 60 秒')).toBe(true)
    expect(editFirstUserTextHasDuration('make it 90 seconds')).toBe(true)
    expect(editFirstUserTextHasDuration('开始生成短片')).toBe(false)
    expect(readEditFirstDurationTier('我选择一分钟')).toBe('medium')
    expect(readEditFirstDurationTier('make it 90 seconds')).toBe('long')
    expect(readEditFirstDurationTier('make it 2 minutes')).toBe('long')
    expect(readEditFirstDurationTier('make it 180 seconds')).toBeNull()
    expect(readEditFirstAspectRatio('我选择 16:9')).toBe('16:9')
  })

  it('builds a duration and aspect-ratio card when the model requests it at the screenplay stage', async () => {
    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('ready_to_generate_screenplay'),
      choiceType: 'duration_and_aspect_ratio',
      toolCallId: 'tool-call-1',
    })

    expect(card).toMatchObject({
      cardId: 'edit-first-duration-aspect-ratio',
      toolCallId: 'tool-call-1',
      choiceType: 'duration_and_aspect_ratio',
      autoSubmitOnReady: true,
      title: '选择短片时长和画面比例',
      groups: [
        {
          key: 'durationTier',
          required: true,
        },
        {
          key: 'aspectRatio',
          required: true,
        },
      ],
      submit: {
        kind: 'set_project_video_ratio',
        projectId: 'project-1',
      },
    })
    expect(card.groups[0]?.options.map((option) => option.value)).toEqual(['short', 'medium', 'long'])
    expect(card.groups[1]?.options.map((option) => option.value)).toEqual(['9:16', '16:9', '21:9'])
    expect(prismaState.screenplayFindFirst).not.toHaveBeenCalled()
  })

  it('rejects duration and aspect-ratio cards outside the screenplay generation stage', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('needs_style_choice'),
      choiceType: 'duration_and_aspect_ratio',
      toolCallId: 'tool-call-1',
    })).rejects.toThrow('EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=duration_and_aspect_ratio:stage=needs_style_choice')
  })

  it('builds a screenplay review card after screenplay generation', async () => {
    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('screenplay_ready_for_review'),
      choiceType: 'screenplay_review',
      toolCallId: 'tool-call-1',
    })

    expect(card).toMatchObject({
      cardId: 'edit-first-screenplay-review',
      toolCallId: 'tool-call-1',
      choiceType: 'screenplay_review',
      variant: 'confirm_or_reply',
      title: '审核剧本',
      groups: [],
      submitLabel: '确认',
      submit: {
        kind: 'submit_tool_output',
      },
      replyLabel: '其他想法',
      replyToolOutputKey: 'revisionNotes',
    })
  })

  it('rejects screenplay review cards outside the screenplay review stage', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('ready_to_generate_screenplay'),
      choiceType: 'screenplay_review',
      toolCallId: 'tool-call-1',
    })).rejects.toThrow('EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=screenplay_review:stage=ready_to_generate_screenplay')
  })

  it('builds a style card from the available completed style previews', async () => {
    prismaState.projectFindFirst.mockResolvedValueOnce({
      videoRatio: '16:9',
    })
    prismaState.screenplayFindFirst.mockResolvedValueOnce({
      id: 'screenplay-1',
      status: 'style_preview_ready',
      stylePreviews: [
        {
          id: 'style-a',
          styleKey: 'A',
          title: '硬核写实科幻风格',
          summary: '高精度数字化质感。',
          imageKey: 'a.png',
        },
        {
          id: 'style-b',
          styleKey: 'B',
          title: '史诗胶片宽银幕风格',
          summary: '浓郁胶片颗粒。',
          imageKey: 'b.png',
        },
        {
          id: 'style-c',
          styleKey: 'C',
          title: '极简克制艺术风格',
          summary: '低反差极简画面。',
          imageKey: null,
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

    expect(prismaState.screenplayFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: 'project-1',
        episodeId: 'episode-1',
        project: {
          userId: 'user-1',
        },
      }),
    }))
    expect(card).toMatchObject({
      cardId: 'edit-first-style:screenplay-1',
      toolCallId: 'tool-call-1',
      choiceType: 'style',
      groups: [
        {
          key: 'stylePreviewId',
          required: true,
        },
      ],
      submit: {
        kind: 'confirm_edit_style_preview',
        projectId: 'project-1',
        episodeId: 'episode-1',
        aspectRatio: '16:9',
      },
    })
    expect(card.groups[0]?.options.map((option) => option.value)).toEqual(['style-a', 'style-b', 'style-c'])
    expect(card.groups[0]?.options[0]?.imageUrl).toBe('/signed/a.png')
    expect(card.groups).toHaveLength(1)
  })

  it('renders style card options from the actual completed preview count', async () => {
    prismaState.projectFindFirst.mockResolvedValueOnce({
      videoRatio: '16:9',
    })
    prismaState.screenplayFindFirst.mockResolvedValueOnce({
      id: 'screenplay-1',
      status: 'style_preview_ready',
      stylePreviews: [
        {
          id: 'style-a',
          styleKey: 'A',
          title: '暗黑手绘插画',
          summary: '更黑暗。',
          imageKey: 'a.png',
        },
        {
          id: 'style-b',
          styleKey: 'B',
          title: '黑白插画',
          summary: '更克制。',
          imageKey: 'b.png',
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
      cardId: 'edit-first-asset-review',
      toolCallId: 'tool-call-1',
      choiceType: 'asset_review',
      variant: 'confirm_or_reply',
      title: '审核分镜资产',
      groups: [],
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

  it('rejects asset review cards outside the asset review stage', async () => {
    await expect(buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('ready_to_generate_cinematography'),
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
    })).rejects.toThrow('EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=asset_review:stage=ready_to_generate_cinematography')
  })

})
