import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LongTextDetectionPrompt from '@/components/story-input/LongTextDetectionPrompt'

const portalMocks = vi.hoisted(() => {
  return {
    currentPortalTarget: null as unknown,
    createPortalMock: vi.fn((node: React.ReactNode, target: unknown) => {
      const targetLabel = target === portalMocks.currentPortalTarget ? 'body' : 'unknown'
      return createElement('div', { 'data-portal-target': targetLabel }, node)
    }),
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

describe('LongTextDetectionPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks()
    portalMocks.currentPortalTarget = null
    Reflect.deleteProperty(globalThis, 'React')
    Reflect.deleteProperty(globalThis, 'document')
  })

  it('renders through document.body at modal layer without the removed gradient border wrapper', () => {
    const fakeDocument = {
      body: { nodeName: 'BODY' },
    }

    Reflect.set(globalThis, 'React', React)
    Reflect.set(globalThis, 'document', fakeDocument)
    portalMocks.currentPortalTarget = fakeDocument.body

    const html = renderToStaticMarkup(
      createElement(LongTextDetectionPrompt, {
        open: true,
        copy: {
          title: '建议使用智能分集',
          description: '检测到文本较长',
          strongRecommend: '建议拆分',
          smartSplitLabel: '智能分集',
          smartSplitBadge: '推荐',
          continueLabel: '仍然单集创作',
          continueHint: '单集模式',
        },
        onClose: () => undefined,
        onSmartSplit: () => undefined,
        onContinue: () => undefined,
      }),
    )

    expect(portalMocks.createPortalMock).toHaveBeenCalledTimes(1)
    expect(portalMocks.createPortalMock.mock.calls[0]?.[1]).toBe(fakeDocument.body)
    expect(html).toContain('data-portal-target="body"')
    expect(html).toContain('z-[120]')
    expect(html).toContain('border-[var(--glass-stroke-base)]')
    expect(html).not.toContain('p-[1.5px]')
  })
})
