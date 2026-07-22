import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import EpisodeCoverCard, {
  resolveEpisodeCoverAspectRatio,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/EpisodeCoverCard'
import { resolveTaskPresentationState } from '@/lib/task/presentation'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) =>
    createElement('span', { 'data-icon': name, className }),
}))

vi.mock('@/components/media/MediaImageWithLoading', () => ({
  MediaImageWithLoading: ({ src, alt, className }: { src: string; alt: string; className?: string }) =>
    createElement('img', { src, alt, className }),
}))

vi.stubGlobal('React', React)

describe('EpisodeCoverCard', () => {
  it('renders an existing pure-image cover with a regenerate action', () => {
    const html = renderToStaticMarkup(
      createElement(EpisodeCoverCard, {
        coverImageUrl: '/m/episode-cover.webp',
        videoRatio: '16:9',
        taskState: null,
        errorMessage: null,
        onGenerate: () => undefined,
      }),
    )

    expect(html).toContain('src="/m/episode-cover.webp"')
    expect(html).toContain('episodeCover.regenerate')
    expect(html).toContain('aspect-ratio:16 / 9')
  })

  it('shows generation progress and disables duplicate submission', () => {
    const taskState = resolveTaskPresentationState({
      phase: 'processing',
      intent: 'generate',
      resource: 'image',
      hasOutput: false,
    })
    const html = renderToStaticMarkup(
      createElement(EpisodeCoverCard, {
        coverImageUrl: null,
        videoRatio: '9:16',
        taskState,
        errorMessage: null,
        onGenerate: () => undefined,
      }),
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('episodeCover.generating')
    expect(html).toContain('aspect-ratio:9 / 16')
  })

  it('shows a retry action after failure', () => {
    const taskState = resolveTaskPresentationState({
      phase: 'failed',
      intent: 'generate',
      resource: 'image',
      hasOutput: false,
    })
    const html = renderToStaticMarkup(
      createElement(EpisodeCoverCard, {
        coverImageUrl: null,
        videoRatio: 'invalid',
        taskState,
        errorMessage: 'provider failed',
        onGenerate: () => undefined,
      }),
    )

    expect(html).toContain('provider failed')
    expect(html).toContain('episodeCover.retry')
    expect(resolveEpisodeCoverAspectRatio('invalid')).toBe('16 / 9')
  })
})
