import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useMutation, useQueryClient } = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation,
  useQueryClient,
}))

describe('first/last-frame prompt cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMutation.mockImplementation((options) => options)
    useQueryClient.mockReturnValue({})
  })

  it('does not invalidate every query after automatic prompt generation', async () => {
    const mutations = await import('@/lib/query/mutations/useVideoMutations')

    mutations.useGenerateFirstLastFramePrompt('project-1')
    const [generateMutationOptions] = useMutation.mock.calls[0] as [{ onSettled?: unknown }]

    expect(generateMutationOptions.onSettled).toBeUndefined()
  })

  it('invalidates project, episode, storyboard, and video-stage caches', async () => {
    const mutations = await import('@/lib/query/mutations/useVideoMutations')
    const invalidateQueries = vi.fn(async (options: unknown) => {
      void options
    })

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
