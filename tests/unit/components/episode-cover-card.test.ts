import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EpisodeCoverCard, {
  EpisodeCoverSection,
  resolveEpisodeCoverAspectRatio,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/EpisodeCoverCard'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'

const runtime = vi.hoisted(() => ({
  taskState: null as TaskTargetState | null,
  terminalSignatureRef: { current: '' },
  invalidateQueries: vi.fn(async () => undefined),
  generateCover: {
    error: null,
    isPending: false,
    mutate: vi.fn(),
  },
}))
const invalidateEpisodeQueriesMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
    useRef: () => runtime.terminalSignatureRef,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: runtime.invalidateQueries,
  }),
}))

vi.mock('@/lib/query/hooks', () => ({
  useGenerateEpisodeCover: () => runtime.generateCover,
}))

vi.mock('@/lib/query/hooks/useTaskTargetStateMap', () => ({
  useTaskTargetStateMap: () => ({
    getState: () => runtime.taskState,
  }),
}))

vi.mock('@/lib/query/episode-cache', () => ({
  invalidateEpisodeQueries: invalidateEpisodeQueriesMock,
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
  beforeEach(() => {
    runtime.taskState = null
    runtime.terminalSignatureRef.current = ''
    runtime.invalidateQueries.mockClear()
    runtime.generateCover.mutate.mockClear()
    invalidateEpisodeQueriesMock.mockClear()
  })

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

  it('recovers each polling-discovered terminal episode-cover state exactly once', () => {
    runtime.taskState = {
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-a',
      phase: 'completed',
      runningTaskId: null,
      runningTaskType: null,
      intent: 'generate',
      hasOutputAtStart: false,
      progress: 100,
      stage: null,
      stageLabel: null,
      lastError: null,
      updatedAt: '2026-07-23T01:00:00.000Z',
    }

    const props = {
      projectId: 'project-1',
      episodeId: 'episode-a',
      coverImageUrl: null,
      videoRatio: '16:9',
    }
    renderToStaticMarkup(createElement(EpisodeCoverSection, props))
    renderToStaticMarkup(createElement(EpisodeCoverSection, props))

    expect(invalidateEpisodeQueriesMock).toHaveBeenCalledTimes(1)
    expect(invalidateEpisodeQueriesMock).toHaveBeenCalledWith(expect.any(Object), 'project-1', 'episode-a')
    expect(runtime.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(runtime.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['project-data', 'project-1'],
    })

    runtime.taskState = {
      ...runtime.taskState,
      phase: 'failed',
      updatedAt: '2026-07-23T01:00:01.000Z',
    }
    renderToStaticMarkup(createElement(EpisodeCoverSection, props))

    expect(invalidateEpisodeQueriesMock).toHaveBeenCalledTimes(2)
    expect(runtime.invalidateQueries).toHaveBeenCalledTimes(2)
  })
})
