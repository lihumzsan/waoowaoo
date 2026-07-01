import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BillingActionButton from '@/components/billing/BillingActionButton'

describe('BillingActionButton', () => {
  it('renders the action and compact credit suffix on one flat line', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(BillingActionButton, {
        type: 'button',
        icon: 'image',
        label: '生成图片',
        quote: {
          fullLabel: '1 个媒体生成任务 · 预计消耗 1.1376 credits',
          mediaTaskCount: 1,
          totalMaxFrozenCost: 1.1376,
          costLabel: '1.14',
        },
      }),
    )

    expect(html).toContain('生成图片')
    expect(html).toContain('1.14')
    expect(html).toContain('whitespace-nowrap')
    expect(html).toContain('title="1 个媒体生成任务 · 预计消耗 1.1376 credits"')
  })
})
