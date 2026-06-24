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
  it('renders the project logo with the shared left-to-right loading motion', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(createElement(BrandLoading))

    expect(html).toContain('data-brand-logo-motion="loading"')
    expect(html).toContain('<title')
    expect(html).toContain('waoowaoo')
    expect(html).toContain('href="/logo-small.png"')
    expect(html).toContain('brand-logo-mark__reveal')
    expect(html).toContain('brand-logo-mark__sweep')
    expect(html).toContain('class="sr-only"')
  })

  it('keeps page loading on the glass full-screen surface', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(createElement(BrandPageLoading))

    expect(html).toContain('glass-page')
    expect(html).toContain('min-h-screen')
    expect(html).toContain('data-brand-logo-motion="loading"')
  })
})
