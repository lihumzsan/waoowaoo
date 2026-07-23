import * as React from 'react'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EpisodeCoverCard, {
  EpisodeCoverSection,
  resolveEpisodeCoverAspectRatio,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/EpisodeCoverCard'
import { queryKeys } from '@/lib/query/keys'
import type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import { TASK_TYPE } from '@/lib/task/types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

vi.stubGlobal('React', React)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) => (
    createElement('span', { 'data-icon': name, className })
  ),
}))

vi.mock('@/components/media/MediaImageWithLoading', () => ({
  MediaImageWithLoading: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    createElement('img', { src, alt, className })
  ),
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function taskState(episodeId: string, phase: TaskTargetState['phase'], updatedAt: string | null): TaskTargetState {
  return {
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    phase,
    runningTaskId: null,
    runningTaskType: null,
    intent: 'generate',
    hasOutputAtStart: false,
    progress: phase === 'completed' ? 100 : null,
    stage: null,
    stageLabel: null,
    lastError: phase === 'failed' ? { code: 'FAILED', message: 'provider failed' } : null,
    updatedAt,
  }
}

function targetStatesKey(projectId: string, episodeId: string) {
  return queryKeys.tasks.targetStates(projectId, JSON.stringify([{
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    types: [TASK_TYPE.IMAGE_EPISODE_COVER],
  }]))
}

function renderCoverSection(queryClient: QueryClient, projectId: string, episodeId: string) {
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(EpisodeCoverSection, {
      key: episodeId,
      projectId,
      episodeId,
      coverImageUrl: null,
      videoRatio: '16:9',
    }),
  )
}

const renderers: ReactTestRenderer[] = []

afterEach(async () => {
  await act(async () => {
    for (const renderer of renderers.splice(0)) renderer.unmount()
  })
})

describe('EpisodeCoverCard', () => {
  it('renders an existing pure-image cover with a regenerate action', async () => {
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(
        createElement(EpisodeCoverCard, {
          coverImageUrl: '/m/episode-cover.webp',
          videoRatio: '16:9',
          taskState: null,
          errorMessage: null,
          onGenerate: () => undefined,
        }),
      )
    })
    renderers.push(renderer!)

    expect(JSON.stringify(renderer!.toJSON())).toContain('episodeCover.regenerate')
    expect(JSON.stringify(renderer!.toJSON())).toContain('/m/episode-cover.webp')
    expect(resolveEpisodeCoverAspectRatio('16:9')).toBe('16 / 9')
  })

  it('shows generation progress and disables duplicate submission', async () => {
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(
        createElement(EpisodeCoverCard, {
          coverImageUrl: null,
          videoRatio: '9:16',
          taskState: {
            isRunning: true,
            isError: false,
            phase: 'processing',
            intent: 'generate',
            resource: 'image',
            hasOutput: false,
            mode: 'placeholder',
            labelKey: 'taskStatus.intent.generate.running.image',
          },
          errorMessage: null,
          onGenerate: () => undefined,
        }),
      )
    })
    renderers.push(renderer!)

    const button = renderer!.root.findByType('button')
    expect(button.props.disabled).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).toContain('episodeCover.generating')
  })

  it('shows a retry action after failure', async () => {
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(
        createElement(EpisodeCoverCard, {
          coverImageUrl: null,
          videoRatio: 'invalid',
          taskState: {
            isRunning: false,
            isError: true,
            phase: 'failed',
            intent: 'generate',
            resource: 'image',
            hasOutput: false,
            mode: 'placeholder',
            labelKey: 'taskStatus.failed.image',
          },
          errorMessage: 'provider failed',
          onGenerate: () => undefined,
        }),
      )
    })
    renderers.push(renderer!)

    expect(JSON.stringify(renderer!.toJSON())).toContain('provider failed')
    expect(JSON.stringify(renderer!.toJSON())).toContain('episodeCover.retry')
    expect(resolveEpisodeCoverAspectRatio('invalid')).toBe('16 / 9')
  })

  it('refreshes repeated null-timestamp terminal generations after a processing transition', async () => {
    const projectId = 'project-1'
    const episodeId = 'episode-a'
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(targetStatesKey(projectId, episodeId), [taskState(episodeId, 'completed', null)])

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(renderCoverSection(queryClient, projectId, episodeId))
    })
    renderers.push(renderer!)

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.episodeDataPrefix(projectId, episodeId),
      exact: false,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projectData(projectId) })

    await act(async () => {
      renderer!.update(renderCoverSection(queryClient, projectId, episodeId))
    })
    expect(invalidateQueries.mock.calls.filter(([filters]) =>
      JSON.stringify(filters) === JSON.stringify({ queryKey: queryKeys.projectData(projectId) }),
    )).toHaveLength(1)

    await act(async () => {
      queryClient.setQueryData(targetStatesKey(projectId, episodeId), [taskState(episodeId, 'processing', null)])
      renderer!.update(renderCoverSection(queryClient, projectId, episodeId))
    })
    await act(async () => {
      queryClient.setQueryData(targetStatesKey(projectId, episodeId), [taskState(episodeId, 'completed', null)])
      renderer!.update(renderCoverSection(queryClient, projectId, episodeId))
    })
    await act(async () => {
      queryClient.setQueryData(targetStatesKey(projectId, episodeId), [taskState(episodeId, 'failed', null)])
      renderer!.update(renderCoverSection(queryClient, projectId, episodeId))
    })

    expect(invalidateQueries.mock.calls.filter(([filters]) =>
      JSON.stringify(filters) === JSON.stringify({ queryKey: queryKeys.projectData(projectId) }),
    )).toHaveLength(3)
  })

  it('remounts the terminal signature ref when the selected episode changes', async () => {
    const projectId = 'project-1'
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(targetStatesKey(projectId, 'episode-a'), [taskState('episode-a', 'completed', null)])
    queryClient.setQueryData(targetStatesKey(projectId, 'episode-b'), [taskState('episode-b', 'completed', null)])

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(renderCoverSection(queryClient, projectId, 'episode-a'))
    })
    renderers.push(renderer!)
    await act(async () => {
      renderer!.update(renderCoverSection(queryClient, projectId, 'episode-b'))
    })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.episodeDataPrefix(projectId, 'episode-a'),
      exact: false,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.episodeDataPrefix(projectId, 'episode-b'),
      exact: false,
    })
  })
})
