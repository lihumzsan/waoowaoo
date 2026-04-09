import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'

vi.mock('@/components/ui/icons', () => ({
  AppIcon: () => createElement('span', null),
}))

vi.mock('@/components/task/TaskStatusOverlay', () => ({
  default: () => createElement('div', null, 'overlay'),
}))

vi.mock('@/components/media/MediaImageWithLoading', () => ({
  MediaImageWithLoading: (props: { containerClassName?: string; className?: string }) =>
    createElement('div', { className: [props.containerClassName, props.className].filter(Boolean).join(' ') }),
}))

const messages = {
  assets: {
    common: {
      generateFailed: '生成失败',
      preview: '预览',
    },
    image: {
      optionNumber: '方案 {number}',
      useThis: '选择此方案',
      cancelSelection: '取消选择',
    },
  },
} as const

const TestIntlProvider = NextIntlClientProvider as React.ComponentType<{
  locale: string
  messages: AbstractIntlMessages
  timeZone: string
  children?: React.ReactNode
}>

describe('CharacterCardGallery aspect ratio', () => {
  it('renders the single-image slot at a fixed 3:2 ratio', async () => {
    Reflect.set(globalThis, 'React', React)
    const { default: CharacterCardGallery } = await import('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/character-card/CharacterCardGallery')

    const html = renderToStaticMarkup(
      createElement(
        TestIntlProvider,
        {
          locale: 'zh',
          messages: messages as unknown as AbstractIntlMessages,
          timeZone: 'Asia/Shanghai',
        },
        createElement(CharacterCardGallery, {
          mode: 'single',
          characterName: '沈烨',
          changeReason: '默认形象',
          aspectClassName: 'aspect-[3/2]',
          currentImageUrl: null,
          selectedIndex: null,
          hasMultipleImages: false,
          isAppearanceTaskRunning: true,
          displayTaskPresentation: null,
          onImageClick: () => undefined,
          overlayActions: null,
        }),
      ),
    )

    expect(html).toContain('aspect-[3/2]')
  })

  it('renders selection cards as interactive buttons with a separate preview action', async () => {
    Reflect.set(globalThis, 'React', React)
    const { default: CharacterCardGallery } = await import('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/character-card/CharacterCardGallery')

    const html = renderToStaticMarkup(
      createElement(
        TestIntlProvider,
        {
          locale: 'zh',
          messages: messages as unknown as AbstractIntlMessages,
          timeZone: 'Asia/Shanghai',
        },
        createElement(CharacterCardGallery, {
          mode: 'selection',
          characterId: 'character-1',
          appearanceId: 'appearance-1',
          characterName: '沈烨',
          imageUrlsWithIndex: [{ url: 'https://example.com/image-1.png', originalIndex: 0 }],
          selectedIndex: null,
          isGroupTaskRunning: false,
          isImageTaskRunning: () => false,
          displayTaskPresentation: null,
          onImageClick: () => undefined,
          onSelectImage: () => undefined,
        }),
      ),
    )

    expect(html).toContain('role="button"')
    expect(html).toContain('aria-label="预览"')
  })
})
