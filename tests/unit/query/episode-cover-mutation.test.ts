import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import type { TaskTargetOverlayMap } from '@/lib/query/task-target-overlay'

const runtime = vi.hoisted(() => ({
  queryData: new Map<string, unknown>(),
  invalidateQueries: vi.fn(async () => undefined),
}))
const requestJsonWithErrorMock = vi.hoisted(() => vi.fn(async () => ({ taskId: 'task-a' })))
const invalidateEpisodeQueriesMock = vi.hoisted(() => vi.fn(async () => undefined))
const useMutationMock = vi.fn((options: unknown) => options)

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: <T,>(queryKey: unknown[], updater: T | ((previous: T | undefined) => T | undefined)) => {
      const key = JSON.stringify(queryKey)
      const previous = runtime.queryData.get(key) as T | undefined
      runtime.queryData.set(key, typeof updater === 'function'
        ? (updater as (value: T | undefined) => T | undefined)(previous)
        : updater)
    },
    getQueryData: <T,>(queryKey: unknown[]) => runtime.queryData.get(JSON.stringify(queryKey)) as T | undefined,
    invalidateQueries: runtime.invalidateQueries,
  }),
  useMutation: (options: unknown) => useMutationMock(options),
}))

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

type GenerateEpisodeCoverMutation = {
  mutationFn: (variables: GenerateEpisodeCoverVariables) => Promise<{ taskId?: string }>
  onMutate: (variables: GenerateEpisodeCoverVariables) => Promise<void>
  onSuccess: (data: { taskId?: string }, variables: GenerateEpisodeCoverVariables) => void
  onError: (error: Error, variables: GenerateEpisodeCoverVariables) => void
  onSettled: (
    data: { taskId?: string } | undefined,
    error: Error | null,
    variables: GenerateEpisodeCoverVariables,
  ) => Promise<void>
}

function getOverlay(projectId: string, targetId: string) {
  const overlay = runtime.queryData.get(JSON.stringify(queryKeys.tasks.targetStateOverlay(projectId))) as TaskTargetOverlayMap | undefined
  return overlay?.[`NovelPromotionEpisode:${targetId}`]
}

describe('useGenerateEpisodeCover', () => {
  beforeEach(() => {
    runtime.queryData.clear()
    runtime.invalidateQueries.mockClear()
    requestJsonWithErrorMock.mockClear()
    invalidateEpisodeQueriesMock.mockClear()
    useMutationMock.mockClear()
  })

  it('keeps stale callbacks bound to the initiating episode after the selected episode changes', async () => {
    const projectId = 'project-1'
    const mutationForEpisodeA = useGenerateEpisodeCover(projectId) as unknown as GenerateEpisodeCoverMutation

    await mutationForEpisodeA.onMutate({ episodeId: 'episode-a', hasOutput: false })
    const mutationForEpisodeB = useGenerateEpisodeCover(projectId) as unknown as GenerateEpisodeCoverMutation
    await mutationForEpisodeB.onMutate({ episodeId: 'episode-b', hasOutput: true })

    const response = await mutationForEpisodeA.mutationFn({ episodeId: 'episode-a', hasOutput: false })
    mutationForEpisodeA.onSuccess(response, { episodeId: 'episode-a', hasOutput: false })

    expect(requestJsonWithErrorMock).toHaveBeenCalledWith(
      '/api/novel-promotion/project-1/episodes/episode-a/cover',
      expect.objectContaining({ method: 'POST' }),
      'Failed to generate episode cover',
    )
    expect(getOverlay(projectId, 'episode-a')).toMatchObject({
      runningTaskId: 'task-a',
      intent: 'generate',
      hasOutputAtStart: false,
    })
    expect(getOverlay(projectId, 'episode-b')).toMatchObject({
      intent: 'regenerate',
      hasOutputAtStart: true,
    })
  })

  it('clears and invalidates only the initiating episode when its stale callbacks fail and settle', async () => {
    const projectId = 'project-1'
    const mutationForEpisodeA = useGenerateEpisodeCover(projectId) as unknown as GenerateEpisodeCoverMutation
    const mutationForEpisodeB = useGenerateEpisodeCover(projectId) as unknown as GenerateEpisodeCoverMutation

    await mutationForEpisodeA.onMutate({ episodeId: 'episode-a', hasOutput: false })
    await mutationForEpisodeB.onMutate({ episodeId: 'episode-b', hasOutput: true })
    mutationForEpisodeA.onError(new Error('A failed'), { episodeId: 'episode-a', hasOutput: false })
    await mutationForEpisodeA.onSettled(undefined, new Error('A failed'), { episodeId: 'episode-a', hasOutput: false })

    expect(getOverlay(projectId, 'episode-a')).toBeUndefined()
    expect(getOverlay(projectId, 'episode-b')).toMatchObject({
      intent: 'regenerate',
      hasOutputAtStart: true,
    })
    expect(invalidateEpisodeQueriesMock).toHaveBeenCalledWith(expect.any(Object), projectId, 'episode-a')
    expect(invalidateEpisodeQueriesMock).not.toHaveBeenCalledWith(expect.any(Object), projectId, 'episode-b')
    expect(runtime.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectData(projectId),
    })
  })
})
