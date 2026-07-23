import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const findManyMock = vi.hoisted(() => vi.fn())
const attachEpisodesMock = vi.hoisted(() => vi.fn(async (episodes: Array<Record<string, unknown>>) => (
  episodes.map((episode) => ({
    ...episode,
    coverImageMedia: {
      id: episode.coverImageMediaId,
      url: `/m/episode-cover-${String(episode.coverImageMediaId).replace('media-cover-', '')}`,
    },
    coverImageUrl: `/m/episode-cover-${String(episode.coverImageMediaId).replace('media-cover-', '')}`,
  }))
)))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireProjectAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    novelData: { id: 'novel-data-1' },
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionEpisode: {
      findMany: findManyMock,
    },
  },
}))

vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToEpisodes: attachEpisodesMock,
}))

describe('Episode cover query contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findManyMock.mockResolvedValue([
      {
        id: 'episode-1',
        episodeNumber: 1,
        name: 'Episode 1',
        coverImageMediaId: 'media-cover-1',
      },
      {
        id: 'episode-2',
        episodeNumber: 2,
        name: 'Episode 2',
        coverImageMediaId: 'media-cover-2',
      },
    ])
  })

  it('returns attached cover media for the Episode list', async () => {
    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const request = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes',
      method: 'GET',
    })

    const response = await route.GET(request, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(attachEpisodesMock).toHaveBeenCalledTimes(1)
    expect(attachEpisodesMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'episode-1', coverImageMediaId: 'media-cover-1' }),
      expect.objectContaining({ id: 'episode-2', coverImageMediaId: 'media-cover-2' }),
    ])
    expect(findManyMock).toHaveBeenCalledWith({
      where: { novelPromotionProjectId: 'novel-data-1' },
      orderBy: { episodeNumber: 'asc' },
    })
    expect(body.episodes[0]).toMatchObject({
      coverImageMediaId: 'media-cover-1',
      coverImageMedia: { id: 'media-cover-1', url: '/m/episode-cover-1' },
      coverImageUrl: '/m/episode-cover-1',
    })
    expect(body.episodes[1]).toMatchObject({
      coverImageMediaId: 'media-cover-2',
      coverImageMedia: { id: 'media-cover-2', url: '/m/episode-cover-2' },
      coverImageUrl: '/m/episode-cover-2',
    })
  })
})
