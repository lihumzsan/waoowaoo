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

const apiFetchMock = vi.hoisted(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  return vi.fn()
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: apiFetchMock,
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
  const isActive = phase === 'queued' || phase === 'processing'
  return {
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    phase,
    runningTaskId: isActive ? `task-${episodeId}` : null,
    runningTaskType: isActive ? TASK_TYPE.IMAGE_EPISODE_COVER : null,
    intent: 'generate',
    hasOutputAtStart: false,
    progress: phase === 'completed' ? 100 : null,
    stage: null,
    stageLabel: null,
    lastError: phase === 'failed' ? { code: 'FAILED', message: 'provider failed' } : null,
    updatedAt,
  }
}

function targetStatesResponse(states: TaskTargetState[]) {
  return {
    ok: true,
    json: async () => ({ states }),
  } as Response
}

function requestedEpisodeId(callIndex: number): string | null {
  const init = apiFetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined
  if (typeof init?.body !== 'string') return null
  const payload = JSON.parse(init.body) as {
    targets?: Array<{ targetId?: string }>
  }
  return payload.targets?.[0]?.targetId ?? null
}

function countInvalidations(
  calls: readonly (readonly unknown[])[],
  filters: Record<string, unknown>,
) {
  return calls.filter(([actualFilters]) =>
    JSON.stringify(actualFilters) === JSON.stringify(filters),
  ).length
}

async function advancePollingTimers(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
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
  apiFetchMock.mockReset()
  vi.useRealTimers()
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

  it('polls a server-discovered processing task without an overlay and stops after terminal recovery', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'))
    const projectId = 'project-1'
    const episodeId = 'episode-a'
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const completed = taskState(episodeId, 'completed', '2026-07-23T00:00:05.000Z')
    apiFetchMock
      .mockResolvedValueOnce(targetStatesResponse([
        taskState(episodeId, 'processing', '2026-07-23T00:00:00.000Z'),
      ]))
      .mockResolvedValueOnce(targetStatesResponse([completed]))

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(renderCoverSection(queryClient, projectId, episodeId))
    })
    renderers.push(renderer!)
    await advancePollingTimers(120)
    await advancePollingTimers(1)

    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(requestedEpisodeId(0)).toBe(episodeId)

    await advancePollingTimers(5_120)

    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      {
        queryKey: queryKeys.episodeDataPrefix(projectId, episodeId),
        exact: false,
      },
    )).toBe(1)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      { queryKey: queryKeys.projectData(projectId) },
    )).toBe(1)

    await act(async () => {
      queryClient.setQueryData(targetStatesKey(projectId, episodeId), [completed])
      renderer!.update(renderCoverSection(queryClient, projectId, episodeId))
    })
    await advancePollingTimers(15_000)

    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      { queryKey: queryKeys.projectData(projectId) },
    )).toBe(1)
  })

  it('keeps server-active polling after the optimistic overlay TTL and stops on unmount', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'))
    const projectId = 'project-1'
    const episodeId = 'episode-a'
    const queryClient = createQueryClient()
    queryClient.setQueryData(queryKeys.tasks.targetStateOverlay(projectId), {
      [`NovelPromotionEpisode:${episodeId}`]: {
        targetType: 'NovelPromotionEpisode',
        targetId: episodeId,
        phase: 'queued',
        runningTaskId: `task-${episodeId}`,
        runningTaskType: TASK_TYPE.IMAGE_EPISODE_COVER,
        intent: 'generate',
        hasOutputAtStart: false,
        progress: null,
        stage: null,
        stageLabel: null,
        updatedAt: '2026-07-23T00:00:00.000Z',
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    })
    apiFetchMock.mockImplementation(async () => targetStatesResponse([
      taskState(episodeId, 'processing', new Date().toISOString()),
    ]))

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(renderCoverSection(queryClient, projectId, episodeId))
    })
    renderers.push(renderer!)
    await advancePollingTimers(30_500)
    await advancePollingTimers(1)

    const callsAfterOverlayTtl = apiFetchMock.mock.calls.length
    expect(callsAfterOverlayTtl).toBe(6)

    await act(async () => {
      queryClient.setQueryData(queryKeys.tasks.targetStateOverlay(projectId), {})
    })
    await advancePollingTimers(5_120)
    expect(apiFetchMock).toHaveBeenCalledTimes(callsAfterOverlayTtl + 1)

    await act(async () => {
      renderer!.unmount()
    })
    renderers.splice(renderers.indexOf(renderer!), 1)
    const callsAtUnmount = apiFetchMock.mock.calls.length

    await advancePollingTimers(15_000)

    expect(apiFetchMock).toHaveBeenCalledTimes(callsAtUnmount)
  })

  it.each([
    {
      label: 'completed with a null timestamp',
      phase: 'completed' as const,
      updatedAt: null,
    },
    {
      label: 'failed with an older timestamp',
      phase: 'failed' as const,
      updatedAt: '2026-07-22T23:59:59.000Z',
    },
  ])('reveals $label immediately when polling finishes after the overlay TTL', async ({
    phase,
    updatedAt,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'))
    const projectId = 'project-1'
    const episodeId = 'episode-a'
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const processing = taskState(episodeId, 'processing', '2026-07-23T00:00:00.000Z')
    const terminal = taskState(episodeId, phase, updatedAt)
    queryClient.setQueryData(queryKeys.tasks.targetStateOverlay(projectId), {
      [`NovelPromotionEpisode:${episodeId}`]: {
        targetType: 'NovelPromotionEpisode',
        targetId: episodeId,
        phase: 'queued',
        runningTaskId: `task-${episodeId}`,
        runningTaskType: TASK_TYPE.IMAGE_EPISODE_COVER,
        intent: 'generate',
        hasOutputAtStart: false,
        progress: null,
        stage: null,
        stageLabel: null,
        updatedAt: '2026-07-23T00:00:00.000Z',
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    })
    apiFetchMock.mockImplementation(async () => targetStatesResponse([
      apiFetchMock.mock.calls.length <= 6 ? processing : terminal,
    ]))

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(renderCoverSection(queryClient, projectId, episodeId))
    })
    renderers.push(renderer!)
    await advancePollingTimers(121)
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await advancePollingTimers(5_120)
    }

    expect(apiFetchMock).toHaveBeenCalledTimes(6)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      { queryKey: queryKeys.projectData(projectId) },
    )).toBe(0)

    await advancePollingTimers(5_120)

    expect(apiFetchMock).toHaveBeenCalledTimes(7)
    expect(queryClient.getQueryData<TaskTargetState[]>(
      targetStatesKey(projectId, episodeId),
    )?.[0]).toEqual(terminal)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      {
        queryKey: queryKeys.episodeDataPrefix(projectId, episodeId),
        exact: false,
      },
    )).toBe(1)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      { queryKey: queryKeys.projectData(projectId) },
    )).toBe(1)

    await advancePollingTimers(15_000)

    expect(apiFetchMock).toHaveBeenCalledTimes(7)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      { queryKey: queryKeys.projectData(projectId) },
    )).toBe(1)
  })

  it.each([
    {
      label: 'completed with a null timestamp',
      phase: 'completed' as const,
      updatedAt: null,
    },
    {
      label: 'failed with an older timestamp',
      phase: 'failed' as const,
      updatedAt: '2026-07-22T23:59:59.000Z',
    },
  ])('expires an active overlay over identical $label responses and stops the fallback timer', async ({
    phase,
    updatedAt,
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'))
    const projectId = 'project-1'
    const episodeId = 'episode-a'
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const terminal = taskState(episodeId, phase, updatedAt)
    queryClient.setQueryData(queryKeys.tasks.targetStateOverlay(projectId), {
      [`NovelPromotionEpisode:${episodeId}`]: {
        targetType: 'NovelPromotionEpisode',
        targetId: episodeId,
        phase: 'queued',
        runningTaskId: `task-${episodeId}`,
        runningTaskType: TASK_TYPE.IMAGE_EPISODE_COVER,
        intent: 'generate',
        hasOutputAtStart: false,
        progress: null,
        stage: null,
        stageLabel: null,
        updatedAt: '2026-07-23T00:00:00.000Z',
        lastError: null,
        expiresAt: Date.now() + 30_000,
      },
    })
    apiFetchMock.mockImplementation(async () => targetStatesResponse([terminal]))

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(renderCoverSection(queryClient, projectId, episodeId))
    })
    renderers.push(renderer!)
    await advancePollingTimers(121)
    await advancePollingTimers(29_878)

    expect(countInvalidations(
      invalidateQueries.mock.calls,
      {
        queryKey: queryKeys.episodeDataPrefix(projectId, episodeId),
        exact: false,
      },
    )).toBe(0)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      { queryKey: queryKeys.projectData(projectId) },
    )).toBe(0)

    await advancePollingTimers(1)
    await advancePollingTimers(120)

    expect(queryClient.getQueryData<TaskTargetState[]>(
      targetStatesKey(projectId, episodeId),
    )?.[0]).toEqual(terminal)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      {
        queryKey: queryKeys.episodeDataPrefix(projectId, episodeId),
        exact: false,
      },
    )).toBe(1)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      { queryKey: queryKeys.projectData(projectId) },
    )).toBe(1)

    const callsAfterExpiry = apiFetchMock.mock.calls.length
    await advancePollingTimers(15_000)
    expect(apiFetchMock).toHaveBeenCalledTimes(callsAfterExpiry)
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      { queryKey: queryKeys.projectData(projectId) },
    )).toBe(1)

    await act(async () => {
      renderer!.unmount()
    })
    renderers.splice(renderers.indexOf(renderer!), 1)
    await advancePollingTimers(15_000)

    expect(apiFetchMock).toHaveBeenCalledTimes(callsAfterExpiry)
  })

  it('switches polling from episode A to B without cross-episode recovery', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'))
    const projectId = 'project-1'
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    apiFetchMock.mockImplementation(async (_input: unknown, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as {
        targets: Array<{ targetId: string }>
      }
      const episodeId = payload.targets[0].targetId
      return targetStatesResponse([
        taskState(
          episodeId,
          episodeId === 'episode-a' ? 'processing' : 'failed',
          '2026-07-23T00:00:00.000Z',
        ),
      ])
    })

    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(renderCoverSection(queryClient, projectId, 'episode-a'))
    })
    renderers.push(renderer!)
    await advancePollingTimers(120)
    await advancePollingTimers(1)

    await act(async () => {
      renderer!.update(renderCoverSection(queryClient, projectId, 'episode-b'))
    })
    await advancePollingTimers(120)
    await advancePollingTimers(1)
    await advancePollingTimers(10_000)

    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryData<TaskTargetState[]>(
      targetStatesKey(projectId, 'episode-b'),
    )?.[0]?.phase).toBe('failed')
    expect(requestedEpisodeId(0)).toBe('episode-a')
    expect(requestedEpisodeId(1)).toBe('episode-b')
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      {
        queryKey: queryKeys.episodeDataPrefix(projectId, 'episode-a'),
        exact: false,
      },
    )).toBe(0)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.episodeDataPrefix(projectId, 'episode-b'),
      exact: false,
    })
    expect(countInvalidations(
      invalidateQueries.mock.calls,
      {
        queryKey: queryKeys.episodeDataPrefix(projectId, 'episode-b'),
        exact: false,
      },
    )).toBe(1)
  })
})
