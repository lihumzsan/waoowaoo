import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import StoryInputComposer from '@/components/story-input/StoryInputComposer'

vi.mock('@/components/selectors/RatioStyleSelectors', () => ({
  RatioSelector: ({
    getUsage: _getUsage,
    ...props
  }: Record<string, unknown> & { getUsage?: unknown }) => createElement('div', props, 'RatioSelector'),
  StyleSelector: (props: Record<string, unknown>) => createElement('div', props, 'StyleSelector'),
}))

describe('StoryInputComposer', () => {
  it('renders a shared composer shell with configurable textarea rows and shared controls', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(StoryInputComposer, {
        value: '测试内容',
        onValueChange: () => undefined,
        placeholder: '请输入内容',
        minRows: 8,
        videoRatio: '9:16',
        onVideoRatioChange: () => undefined,
        ratioOptions: [{ value: '9:16', label: '9:16' }],
        artStyle: 'realistic',
        onArtStyleChange: () => undefined,
        styleOptions: [{ value: 'realistic', label: '真人风格' }],
        topRight: createElement('span', null, '字数：4'),
        footer: createElement('p', null, '当前配置'),
        secondaryActions: createElement('button', { type: 'button' }, 'AI 帮我写'),
        primaryAction: createElement('button', { type: 'button' }, '开始创作'),
      }),
    )

    expect(html).toContain('rows="8"')
    expect(html).toContain('RatioSelector')
    expect(html).toContain('StyleSelector')
    expect(html).toContain('字数：4')
    expect(html).toContain('当前配置')
    expect(html).toContain('AI 帮我写')
    expect(html).toContain('开始创作')
  })

  it('renders without footer or secondary actions', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(StoryInputComposer, {
        value: '测试内容',
        onValueChange: () => undefined,
        placeholder: '请输入内容',
        minRows: 8,
        videoRatio: '9:16',
        onVideoRatioChange: () => undefined,
        ratioOptions: [{ value: '9:16', label: '9:16' }],
        artStyle: 'realistic',
        onArtStyleChange: () => undefined,
        styleOptions: [{ value: 'realistic', label: '真人风格' }],
        primaryAction: createElement('button', { type: 'button' }, '开始创作'),
      }),
    )

    expect(html).toContain('RatioSelector')
    expect(html).toContain('StyleSelector')
    expect(html).toContain('开始创作')
  })
})
