import * as React from 'react'
import { createElement } from 'react'
import type { ComponentProps, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import StylePresetEditor from '@/app/[locale]/profile/components/StylePresetEditor'
import { buildDraft } from '@/app/[locale]/profile/components/stylePresetEditorState'

const messages = {
  profile: {
    stylePresets: {
      fields: {
        name: '名称',
        summary: '简介',
        instruction: '设计需求',
        prompt: '提示词',
      },
      kind: {
        visual_style: '画风',
      },
      kindDescription: {
        visual_style: '控制图片和视觉生成的画面语言',
      },
      design: 'AI 设计',
      designing: '设计中',
    },
  },
} as const

function renderWithIntl(node: ReactElement): string {
  const providerProps: ComponentProps<typeof NextIntlClientProvider> = {
    locale: 'zh',
    messages: messages as unknown as AbstractIntlMessages,
    timeZone: 'Asia/Shanghai',
    children: node,
  }

  return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps))
}

describe('StylePresetEditor', () => {
  it('keeps visual style creation to name and prompt fields', () => {
    Reflect.set(globalThis, 'React', React)
    const draft = buildDraft('visual_style')

    const html = renderWithIntl(
      createElement(StylePresetEditor, {
        draft,
        error: null,
        readOnly: false,
        onNameChange: vi.fn(),
        onVisualConfigChange: vi.fn(),
      }),
    )

    expect(html).toContain('名称')
    expect(html).toContain('提示词')
    expect(html).toContain('glass-input-base h-10')
    expect(html).toContain('glass-input-base w-full resize-none')
    expect(html).not.toContain('简介')
    expect(html).not.toContain('设计需求')
  })
})
