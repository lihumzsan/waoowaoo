import { describe, expect, it } from 'vitest'
import type { ProjectAgentChoiceCardGroup } from '@/lib/project-agent/types'
import {
  interpolateChoiceCardTemplate,
  isChoiceCardSubmitReady,
} from '@/features/project-workspace/components/workspace-assistant/choice-card-actions'

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

  it('interpolates selected values and labels into submit messages', () => {
    const message = interpolateChoiceCardTemplate(
      '已选择风格 {stylePreviewIdLabel} / {stylePreviewId}，画面比例 {aspectRatio}。',
      { stylePreviewId: 'style-a', aspectRatio: '16:9' },
      groups,
    )

    expect(message).toBe('已选择风格 A · 硬核写实科幻风格 / style-a，画面比例 16:9。')
  })
})
