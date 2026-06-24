import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BrandLoading, BrandPageLoading } from '@/components/ui/BrandLoading'

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const messages: Record<string, Record<string, string>> = {
      common: {
        appName: 'waoowaoo',
        loading: '加载中...',
      },
    }
    return messages[namespace]?.[key] ?? `${namespace}.${key}`
  },
}))

describe('BrandLoading', () => {
  it('renders the brand logo as an animated svg loading indicator', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(createElement(BrandLoading))

    // SVG 形状(矢量 logo),而非位图
    expect(html).toContain('<svg')
    expect(html).not.toContain('logo-small.png')
    // 液态浮动动效作用于主体与圆点的 class 钩子
    expect(html).toContain('brand-loading-mark')
    expect(html).toContain('logo-shape__art')
    expect(html).toContain('logo-shape__dot')
    // 可访问性:标题取应用名,sr-only 提示加载中
    expect(html).toContain('<title>waoowaoo</title>')
    expect(html).toContain('class="sr-only"')
    expect(html).toContain('加载中...')
  })

  it('keeps page loading on the glass full-screen surface', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(createElement(BrandPageLoading))

    expect(html).toContain('glass-page')
    expect(html).toContain('min-h-screen')
    expect(html).toContain('<svg')
    expect(html).toContain('brand-loading-mark')
  })
})
