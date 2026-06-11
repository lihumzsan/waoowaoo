import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { ProjectAgentChoiceCardGroup } from '@/lib/project-agent/types'
import {
  isChoiceCardSubmitReady,
  resolveChoiceCardSelectionLabels,
} from '@/features/project-workspace/components/workspace-assistant/choice-card-actions'
import {
  buildStylePreviewGenerationCardFromScreenplay,
  findActiveStylePreviewGenerationCard,
} from '@/features/project-workspace/components/workspace-assistant/active-style-preview-generation'

const groups: ProjectAgentChoiceCardGroup[] = [
  {
    key: 'stylePreviewId',
    label: '视觉风格',
    required: true,
    options: [
      { value: 'style-a', label: 'A · 硬核写实科幻风格' },
      { value: 'style-b', label: 'B · 胶片宽银幕风格' },
    ],
  },
  {
    key: 'aspectRatio',
    label: '画面比例',
    required: true,
    options: [
      { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
    ],
  },
]

describe('workspace assistant choice card actions', () => {
  it('requires every required group before submit', () => {
    expect(isChoiceCardSubmitReady(groups, {})).toBe(false)
    expect(isChoiceCardSubmitReady(groups, { stylePreviewId: 'style-a' })).toBe(false)
    expect(isChoiceCardSubmitReady(groups, { stylePreviewId: 'style-a', aspectRatio: '16:9' })).toBe(true)
  })

  it('resolves selected option labels for tool output payloads', () => {
    expect(resolveChoiceCardSelectionLabels(groups, {
      stylePreviewId: 'style-a',
      aspectRatio: '16:9',
    })).toEqual({
      stylePreviewIdLabel: 'A · 硬核写实科幻风格',
      aspectRatioLabel: '16:9',
    })
  })

  it('keeps the latest style preview generation card active after newer messages', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{
          type: 'data-edit-style-preview-generation',
          data: {
            operationId: 'generate_edit_style_previews',
            projectId: 'project-1',
            episodeId: 'episode-1',
            screenplayId: 'screenplay-1',
            items: [{
              id: 'preview-1',
              styleKey: 'style_a',
              title: '暗黑风格',
              summary: '暗黑摘要',
              taskId: 'task-1',
            }],
          },
        }],
      },
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: '为什么失败？' }],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        parts: [{ type: 'text', text: '我会读取状态。' }],
      },
    ] as unknown as UIMessage[]

    const active = findActiveStylePreviewGenerationCard(messages)

    expect(active?.data.screenplayId).toBe('screenplay-1')
    expect(active?.data.items.map((item) => item.id)).toEqual(['preview-1'])
  })

  it('recovers a style preview generation card from screenplay state after refresh', () => {
    const active = buildStylePreviewGenerationCardFromScreenplay({
      id: 'screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: 'prompt',
      screenplayText: 'screenplay',
      status: 'style_preview_generating',
      styleBible: null,
      stylePreviews: [
        {
          id: 'preview-1',
          projectId: 'project-1',
          episodeId: 'episode-1',
          screenplayId: 'screenplay-1',
          styleKey: 'style_a',
          aspectRatio: '16:9',
          title: '暗黑风格',
          summary: '暗黑摘要',
          styleBible: {},
          gridImagePrompt: 'prompt',
          imageKey: null,
          imageUrl: null,
          status: 'generating',
          taskId: 'task-1',
          errorMessage: null,
        },
      ],
    })

    expect(active?.data.items).toHaveLength(1)
    expect(active?.data.items[0]?.taskId).toBe('task-1')
  })
})
