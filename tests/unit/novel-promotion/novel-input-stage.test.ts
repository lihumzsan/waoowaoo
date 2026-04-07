import * as React from 'react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import NovelInputStage from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/NovelInputStage'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && 'name' in values) {
      return `${key}:${String(values.name)}`
    }
    return key
  },
}))

vi.mock('@/components/story-input/StoryInputComposer', () => ({
  default: ({
    minRows,
    maxHeightViewportRatio,
    textareaClassName,
    topRight,
    footer,
    secondaryActions,
    primaryAction,
  }: {
    minRows: number
    maxHeightViewportRatio: number
    textareaClassName?: string
    topRight?: React.ReactNode
    footer?: React.ReactNode
    secondaryActions?: React.ReactNode
    primaryAction: React.ReactNode
  }) => createElement(
    'section',
    {
      'data-min-rows': String(minRows),
      'data-max-height-ratio': String(maxHeightViewportRatio),
      'data-textarea-class': textareaClassName,
    },
    topRight,
    footer,
    secondaryActions,
    primaryAction,
    'StoryInputComposer',
  ),
}))

vi.mock('@/components/task/TaskStatusInline', () => ({
  default: () => createElement('span', null, 'TaskStatusInline'),
}))

vi.mock('@/components/home/AiWriteModal', () => ({
  default: () => createElement('div', null, 'AiWriteModal'),
}))

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('@/lib/home/ai-story-expand', () => ({
  expandHomeStory: vi.fn(),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, ...props }: { name: string } & Record<string, unknown>) =>
    createElement('span', { ...props, 'data-icon': name }),
}))

describe('NovelInputStage', () => {
  it('uses the shared composer with a taller adaptive baseline in story mode', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(NovelInputStage, {
        novelText: '',
        episodeName: '剧集 1',
        onNovelTextChange: () => undefined,
        onNext: () => undefined,
      }),
    )

    expect(html).toContain('StoryInputComposer')
    expect(html).toContain('data-min-rows="8"')
    expect(html).toContain('data-max-height-ratio="0.5"')
    expect(html).toContain('data-textarea-class="px-0 pt-0 pb-3 align-top"')
    expect(html).toContain('aiWrite.trigger')
    expect(html).toContain('AiWriteModal')
    expect(html).not.toContain('storyInput.wordCount 0')
    expect(html).not.toContain('storyInput.currentConfigSummary')
  })
})
