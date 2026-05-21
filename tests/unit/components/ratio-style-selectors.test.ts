import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RatioSelector, StyleSelector } from '@/components/selectors/RatioStyleSelectors'

const portalMocks = vi.hoisted(() => {
  return {
    currentPortalTarget: null as unknown,
    createPortalMock: vi.fn((node: React.ReactNode, target: unknown) => {
      const targetLabel = target === portalMocks.currentPortalTarget ? 'body' : 'unknown'
      return createElement('div', { 'data-portal-target': targetLabel }, node)
    }),
  }
})

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()

  return {
    ...actual,
    useState: <T,>(initialState: T | (() => T)) => {
      const resolvedInitialState = typeof initialState === 'function'
        ? (initialState as () => T)()
        : initialState

      if (resolvedInitialState === false) {
        return actual.useState(true as T)
      }

      return actual.useState(resolvedInitialState)
    },
  }
})

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    ...actual,
    createPortal: portalMocks.createPortalMock,
  }
})

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) =>
    createElement('span', { 'data-icon': name, className }),
}))

describe('RatioStyleSelectors', () => {
  afterEach(() => {
    vi.clearAllMocks()
    portalMocks.currentPortalTarget = null
    Reflect.deleteProperty(globalThis, 'React')
    Reflect.deleteProperty(globalThis, 'document')
  })

  it('renders ratio and style dropdown panels through a portal to document.body', () => {
    const fakeDocument = {
      body: { nodeName: 'BODY' },
    }

    Reflect.set(globalThis, 'React', React)
    portalMocks.currentPortalTarget = fakeDocument.body
    Reflect.set(globalThis, 'document', fakeDocument)

    const html = renderToStaticMarkup(
      createElement('div', null,
        createElement(RatioSelector, {
          value: '9:16',
          onChange: () => undefined,
          options: [
            { value: '9:16', label: '9:16' },
            { value: '16:9', label: '16:9' },
          ],
        }),
        createElement(StyleSelector, {
          value: 'realistic',
          onChange: () => undefined,
          options: [
            { value: 'realistic', label: '真人风格' },
            { value: 'american-comic', label: '美漫风格' },
          ],
        }),
      ),
    )

    expect(portalMocks.createPortalMock).toHaveBeenCalledTimes(2)
    expect(portalMocks.createPortalMock.mock.calls[0]?.[1]).toBe(fakeDocument.body)
    expect(portalMocks.createPortalMock.mock.calls[1]?.[1]).toBe(fakeDocument.body)
    expect(html).toContain('data-portal-target="body"')
    expect(html).toContain('data-icon="sparklesAlt"')
    expect(html).toContain('真人风格')
    expect(html).toContain('16:9')
  })
})
