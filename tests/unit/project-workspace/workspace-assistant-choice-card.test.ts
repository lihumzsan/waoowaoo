import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { ProjectAgentChoiceCardGroup } from '@/lib/project-agent/types'
import {
  buildChoiceCardCustomOptionValue,
  isChoiceCardSubmitReady,
  mergeChoiceCardCustomOptions,
  resolveChoiceCardSelectionLabels,
  shouldShowChoiceCardManualSubmit,
} from '@/features/project-workspace/components/workspace-assistant/choice-card-actions'
import {
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

  it('resolves per-question custom option labels as normal choice labels', () => {
    const customValue = buildChoiceCardCustomOptionValue('stylePreviewId')
    const mergedGroups = mergeChoiceCardCustomOptions(groups, {
      stylePreviewId: {
        value: customValue,
        label: '复古录像带质感',
        description: null,
      },
    })

    expect(mergedGroups[0]?.options.map((option) => option.value)).toEqual([
      'style-a',
      'style-b',
      customValue,
    ])
    expect(resolveChoiceCardSelectionLabels(mergedGroups, {
      stylePreviewId: customValue,
      aspectRatio: '16:9',
    })).toEqual({
      stylePreviewIdLabel: '复古录像带质感',
      aspectRatioLabel: '16:9',
    })
  })

  it('hides the manual submit button for auto-submit choice cards', () => {
    expect(shouldShowChoiceCardManualSubmit({ autoSubmitOnReady: true })).toBe(false)
    expect(shouldShowChoiceCardManualSubmit({ autoSubmitOnReady: false })).toBe(true)
    expect(shouldShowChoiceCardManualSubmit({ variant: 'confirm' })).toBe(false)
    expect(shouldShowChoiceCardManualSubmit({ variant: 'confirm_or_reply' })).toBe(false)
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
            agentRunId: 'run-1',
            projectId: 'project-1',
            episodeId: 'episode-1',
            bibleId: 'bible-1',
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

    expect(active?.data.bibleId).toBe('bible-1')
    expect(active?.data.agentRunId).toBe('run-1')
    expect(active?.data.items.map((item) => item.id)).toEqual(['preview-1'])
  })

  it('rejects historical style cards that are not bound to an Agent run', () => {
    const messages = [{
      id: 'assistant-orphan',
      role: 'assistant',
      parts: [{
        type: 'data-edit-style-preview-generation',
        data: {
          operationId: 'generate_edit_style_previews',
          projectId: 'project-1',
          episodeId: 'episode-1',
          bibleId: 'bible-1',
          items: [{
            id: 'preview-1',
            styleKey: 'style_a',
            title: '暗黑风格',
            summary: '缺少 run 绑定',
          }],
        },
      }],
    }] as unknown as UIMessage[]

    expect(findActiveStylePreviewGenerationCard(messages)).toBeNull()
  })
})
