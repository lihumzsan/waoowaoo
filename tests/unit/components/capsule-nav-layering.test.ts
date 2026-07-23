import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CapsuleNav, EpisodeSelector } from '@/components/ui/CapsuleNav'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) =>
    createElement('span', { 'data-icon': name, className }),
}))

vi.mock('@/components/media/MediaImageWithLoading', () => ({
  MediaImageWithLoading: ({ src, alt }: { src: string; alt: string }) =>
    createElement('img', { src, alt }),
}))

describe('CapsuleNav layering', () => {
  it('keeps fixed workspace navigation below modal overlays', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement('div', null,
        createElement(CapsuleNav, {
          items: [
            { id: 'config', icon: 'sparkles', label: '配置', status: 'active' as const },
          ],
          activeId: 'config',
          onItemClick: () => undefined,
          projectId: 'project-1',
        }),
        createElement(EpisodeSelector, {
          episodes: [
            { id: 'episode-1', title: '剧集 1', thumbnailUrl: '/m/episode-cover.webp' },
          ],
          currentId: 'episode-1',
          onSelect: () => undefined,
          projectName: '项目 A',
        }),
      ),
    )

    expect(html).toContain('fixed top-20 left-4 z-40 animate-fadeInDown sm:left-1/2 sm:-translate-x-1/2')
    expect(html).toContain('aria-label="配置"')
    expect(html).toContain('sm:hidden')
    expect(html).toContain('whitespace-nowrap px-1')
    expect(html).toContain('sm:px-6')
    expect(html).toContain('hidden text-sm font-semibold sm:inline sm:text-base')
    expect(html).toContain('relative z-40')
    expect(html).toContain('src="/m/episode-cover.webp"')
    expect(html).not.toContain('z-50 animate-fadeInDown')
    expect(html).not.toContain('z-[60]')
  })
})
