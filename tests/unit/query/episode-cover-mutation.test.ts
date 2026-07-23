import * as React from 'react'
import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { QueryClient, QueryClientProvider, type UseMutationResult } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import type { TaskTargetOverlayMap } from '@/lib/query/task-target-overlay'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

vi.stubGlobal('React', React)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const requestJsonWithErrorMock = vi.hoisted(() => vi.fn())
const invalidateEpisodeQueriesMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/query/mutations/mutation-shared', () => ({
  invalidateQueryTemplates: vi.fn(async () => undefined),
  requestBlobWithError: vi.fn(),
  requestJsonWithError: requestJsonWithErrorMock,
  requestTaskResponseWithError: vi.fn(),
}))

vi.mock('@/lib/query/episode-cache', () => ({
  cancelEpisodeQueries: vi.fn(),
  getEpisodeQueriesSnapshot: vi.fn(),
  invalidateEpisodeQueries: invalidateEpisodeQueriesMock,
  restoreEpisodeQueriesSnapshot: vi.fn(),
  setEpisodeQueriesData: vi.fn(),
}))

import { useGenerateEpisodeCover } from '@/lib/query/mutations/useEpisodeMutations'

type GenerateEpisodeCoverVariables = {
  episodeId: string
  hasOutput: boolean
}

type GenerateEpisodeCoverResult = UseMutationResult<{
  success?: boolean
  async?: boolean
  taskId?: string
}, Error, GenerateEpisodeCoverVariables>

type DeferredRequest = {
  resolve: (value: { taskId: string }) => void
  reject: (error: Error) => void
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function MutationHarness({
  projectId,
  onMutation,
}: {
  projectId: string
  onMutation: (mutation: GenerateEpisodeCoverResult) => void
}) {
  const mutation = useGenerateEpisodeCover(projectId)

  useEffect(() => {
    onMutation(mutation)
  }, [mutation, onMutation])

  return createElement(
    'output',
    { 'data-testid': 'episode-cover-mutation-state' },
    `${mutation.status}:${mutation.error?.message || ''}`,
  )
}

function mutationHarness(
  queryClient: QueryClient,
  episodeId: string,
  onMutation: (mutation: GenerateEpisodeCoverResult) => void,
) {
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(MutationHarness, { key: episodeId, projectId: 'project-1', onMutation }),
  )
}

function getOverlay(queryClient: QueryClient, targetId: string) {
  const overlay = queryClient.getQueryData<TaskTargetOverlayMap>(
    queryKeys.tasks.targetStateOverlay('project-1'),
  )
  return overlay?.[`NovelPromotionEpisode:${targetId}`]
}

const renderers: ReactTestRenderer[] = []

afterEach(async () => {
  await act(async () => {
    for (const renderer of renderers.splice(0)) renderer.unmount()
  })
})

describe('useGenerateEpisodeCover', () => {
  beforeEach(() => {
    requestJsonWithErrorMock.mockReset()
    invalidateEpisodeQueriesMock.mockClear()
  })

  it('keeps a completed stale mutation bound to episode A after the UI remounts for episode B', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const pending: DeferredRequest[] = []
    requestJsonWithErrorMock.mockImplementation(() => new Promise((resolve, reject) => {
      pending.push({ resolve, reject })
    }))
    let mutationForEpisodeA: GenerateEpisodeCoverResult | null = null
    let mutationForEpisodeB: GenerateEpisodeCoverResult | null = null
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(mutationHarness(queryClient, 'episode-a', (mutation) => {
        mutationForEpisodeA = mutation
      }))
    })
    renderers.push(renderer!)

    let mutationPromise: Promise<unknown>
    await act(async () => {
      mutationPromise = mutationForEpisodeA!.mutateAsync({ episodeId: 'episode-a', hasOutput: false })
      await Promise.resolve()
    })
    expect(renderer!.root.findByProps({ 'data-testid': 'episode-cover-mutation-state' }).children).toEqual(['pending:'])

    await act(async () => {
      renderer!.update(mutationHarness(queryClient, 'episode-b', (mutation) => {
        mutationForEpisodeB = mutation
      }))
    })
    expect(renderer!.root.findByProps({ 'data-testid': 'episode-cover-mutation-state' }).children).toEqual(['idle:'])

    await act(async () => {
      pending[0].resolve({ taskId: 'task-a' })
      await mutationPromise!
    })

    expect(requestJsonWithErrorMock).toHaveBeenCalledWith(
      '/api/novel-promotion/project-1/episodes/episode-a/cover',
      expect.objectContaining({ method: 'POST' }),
      'Failed to generate episode cover',
    )
    expect(getOverlay(queryClient, 'episode-a')).toMatchObject({ runningTaskId: 'task-a' })
    expect(getOverlay(queryClient, 'episode-b')).toBeUndefined()
    expect(mutationForEpisodeB!.isPending).toBe(false)
    expect(mutationForEpisodeB!.error).toBeNull()
    expect(invalidateEpisodeQueriesMock).toHaveBeenCalledWith(queryClient, 'project-1', 'episode-a')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projectData('project-1') })
  })

  it('clears only episode A when its stale mutation fails after the UI remounts for episode B', async () => {
    const queryClient = createQueryClient()
    const pending: DeferredRequest[] = []
    requestJsonWithErrorMock.mockImplementation(() => new Promise((resolve, reject) => {
      pending.push({ resolve, reject })
    }))
    let mutationForEpisodeA: GenerateEpisodeCoverResult | null = null
    let mutationForEpisodeB: GenerateEpisodeCoverResult | null = null
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(mutationHarness(queryClient, 'episode-a', (mutation) => {
        mutationForEpisodeA = mutation
      }))
    })
    renderers.push(renderer!)

    let mutationPromise: Promise<unknown>
    await act(async () => {
      mutationPromise = mutationForEpisodeA!.mutateAsync({ episodeId: 'episode-a', hasOutput: false })
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.update(mutationHarness(queryClient, 'episode-b', (mutation) => {
        mutationForEpisodeB = mutation
      }))
    })
    await act(async () => {
      pending[0].reject(new Error('A failed'))
      await expect(mutationPromise!).rejects.toThrow('A failed')
    })

    expect(getOverlay(queryClient, 'episode-a')).toBeUndefined()
    expect(getOverlay(queryClient, 'episode-b')).toBeUndefined()
    expect(renderer!.root.findByProps({ 'data-testid': 'episode-cover-mutation-state' }).children).toEqual(['idle:'])
    expect(mutationForEpisodeB!.isPending).toBe(false)
    expect(mutationForEpisodeB!.error).toBeNull()
    expect(invalidateEpisodeQueriesMock).toHaveBeenCalledWith(queryClient, 'project-1', 'episode-a')
  })
})
