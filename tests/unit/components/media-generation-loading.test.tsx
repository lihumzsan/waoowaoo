import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'taskStatus.progressLabel': '生成进度',
      'taskStatus.failed.generic': '生成失败',
    }
    return messages[key] ?? key
  },
}))

vi.mock('@/components/ui/BrandLoading', () => ({
  BrandLoading: () => createElement('span', { 'data-brand-loading': true }),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: (props: { name?: string }) => createElement('span', { 'data-icon': props.name }),
}))

import { MediaGenerationLoadingView } from '@/components/media/MediaGenerationLoading'

describe('MediaGenerationLoadingView', () => {
  it('shows the progress ring and percentage when running with a style image', () => {
    const html = renderToStaticMarkup(
      createElement(MediaGenerationLoadingView, {
        mode: 'running',
        percent: 37,
        styleImageUrl: 'media/style/key.png',
        size: 72,
      }),
    )
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('37%')
    // 有风格图时用模糊背景而非磨砂底
    expect(html).toContain('blur(14px)')
    expect(html).not.toContain('workspace-node-loading-surface')
  })

  it('falls back to the frosted blur surface when no style image is provided', () => {
    const html = renderToStaticMarkup(
      createElement(MediaGenerationLoadingView, {
        mode: 'running',
        percent: 50,
        styleImageUrl: null,
        size: 72,
      }),
    )
    expect(html).toContain('bg-[var(--glass-bg-muted)]')
    expect(html).not.toContain('workspace-node-loading-surface')
    expect(html).toContain('50%')
  })

  it('renders the failure state without a percentage', () => {
    const html = renderToStaticMarkup(
      createElement(MediaGenerationLoadingView, {
        mode: 'failed',
        percent: null,
        size: 72,
      }),
    )
    expect(html).toContain('生成失败')
    expect(html).toContain('data-icon="alertSolid"')
    expect(html).not.toContain('role="progressbar"')
  })

  it('omits the number when progress is indeterminate', () => {
    const html = renderToStaticMarkup(
      createElement(MediaGenerationLoadingView, {
        mode: 'running',
        percent: null,
        size: 72,
      }),
    )
    expect(html).toContain('role="progressbar"')
    // 拿不到进度时不渲染 aria-valuenow,也没有进度环填充段
    expect(html).not.toContain('aria-valuenow')
    expect(html).not.toContain('stroke-dasharray')
  })
})
