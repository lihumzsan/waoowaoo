import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

const prismaState = vi.hoisted(() => ({
  findFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    projectEditScreenplay: {
      findFirst: prismaState.findFirst,
    },
  },
}))

vi.mock('@/lib/storage', () => ({
  getSignedUrl: (key: string) => `/signed/${key}`,
}))

import {
  buildEditFirstAssistantChoiceCards,
  editFirstUserTextHasDuration,
} from '@/lib/project-agent/choice-card'

function workflow(stage: EditFirstWorkflowState['stage']): EditFirstWorkflowState {
  return {
    active: true,
    stage,
    blocking: {
      kind: stage === 'needs_style_choice' ? 'needs_user_choice' : 'needs_confirmation',
      reason: null,
    },
    nextAction: null,
    allowedOperationIds: [],
  }
}

describe('edit-first assistant choice cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaState.findFirst.mockReset()
  })

  it('detects explicit duration in user text', () => {
    expect(editFirstUserTextHasDuration('我选择 60 秒')).toBe(true)
    expect(editFirstUserTextHasDuration('make it 90 seconds')).toBe(true)
    expect(editFirstUserTextHasDuration('开始生成短片')).toBe(false)
  })

  it('asks for duration before screenplay generation when no duration is present', async () => {
    const cards = await buildEditFirstAssistantChoiceCards({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('ready_to_generate_screenplay'),
      requestedGroups: [['edit-script']],
      latestUserText: '开始生成短片',
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      cardId: 'edit-first-duration',
      title: '选择短片时长',
      groups: [{
        key: 'durationSeconds',
        required: true,
      }],
      submit: {
        kind: 'send_message',
      },
    })
    expect(cards[0]?.groups[0]?.options.map((option) => option.value)).toEqual(['30', '60', '90', '120'])
    expect(prismaState.findFirst).not.toHaveBeenCalled()
  })

  it('does not ask for duration again after the user selected one', async () => {
    const cards = await buildEditFirstAssistantChoiceCards({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('ready_to_generate_screenplay'),
      requestedGroups: [['edit-script']],
      latestUserText: '我选择 60 秒，请继续',
    })

    expect(cards).toEqual([])
  })

  it('builds a style and aspect-ratio card only after three style previews are ready', async () => {
    prismaState.findFirst.mockResolvedValueOnce({
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

    const cards = await buildEditFirstAssistantChoiceCards({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow: workflow('needs_style_choice'),
      requestedGroups: [['edit-script']],
      latestUserText: '继续',
    })

    expect(prismaState.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: 'project-1',
        episodeId: 'episode-1',
        project: {
          userId: 'user-1',
        },
      }),
    }))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      cardId: 'edit-first-style-ratio:screenplay-1',
      groups: [
        {
          key: 'stylePreviewId',
          required: true,
        },
        {
          key: 'aspectRatio',
          required: true,
        },
      ],
      submit: {
        kind: 'confirm_edit_style_preview',
        projectId: 'project-1',
        episodeId: 'episode-1',
      },
    })
    expect(cards[0]?.groups[0]?.options.map((option) => option.value)).toEqual(['style-a', 'style-b', 'style-c'])
    expect(cards[0]?.groups[0]?.options[0]?.imageUrl).toBe('/signed/a.png')
    expect(cards[0]?.groups[1]?.options.map((option) => option.value)).toEqual(['9:16', '16:9', '21:9'])
  })
})
