import { describe, expect, it, vi } from 'vitest'

describe('first/last-frame prompt cache invalidation', () => {
  it('invalidates project, episode, storyboard, and video-stage caches', async () => {
    const mutations = await import('@/lib/query/mutations/useVideoMutations')
    const invalidateQueries = vi.fn(async (_options: unknown) => undefined)

    await mutations.invalidateFirstLastFramePromptCaches(
      { invalidateQueries } as never,
      'project-1',
      'episode-1',
    )

    expect(invalidateQueries.mock.calls.map(([options]) => options)).toEqual(expect.arrayContaining([
      { queryKey: ['project-data', 'project-1'] },
      { queryKey: ['episode-data', 'project-1', 'episode-1'], exact: false },
      { queryKey: ['storyboards', 'episode-1'] },
      { queryKey: ['videos', 'episode-1'] },
      { queryKey: ['videos', 'episode-1', 'panels'] },
    ]))
  })
})
