import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BrandLoading, BrandPageLoading } from '@/components/ui/BrandLoading'

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string } & Record<string, unknown>) => createElement('img', { alt, ...props }),
}))

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
  it('renders the project logo as the shared visible loading indicator', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(createElement(BrandLoading))

    expect(html).toContain('src="/logo-small.png"')
    expect(html).toContain('alt="waoowaoo"')
    expect(html).toContain('animate-pulse')
    expect(html).toContain('class="sr-only"')
  })

  it('keeps page loading on the glass full-screen surface', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(createElement(BrandPageLoading))

    expect(html).toContain('glass-page')
    expect(html).toContain('min-h-screen')
    expect(html).toContain('src="/logo-small.png"')
  })
})
