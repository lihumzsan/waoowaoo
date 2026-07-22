import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const findManyMock = vi.hoisted(() => vi.fn())
const attachEpisodeMock = vi.hoisted(() => vi.fn(async (episode: Record<string, unknown>) => ({
  ...episode,
  coverImageMedia: { id: episode.coverImageMediaId, url: '/m/episode-cover-1' },
  coverImageUrl: '/m/episode-cover-1',
})))

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
  attachMediaFieldsToEpisode: attachEpisodeMock,
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
    expect(attachEpisodeMock).toHaveBeenCalledTimes(1)
    expect(findManyMock).toHaveBeenCalledWith({
      where: { novelPromotionProjectId: 'novel-data-1' },
      orderBy: { episodeNumber: 'asc' },
    })
    expect(body.episodes[0]).toMatchObject({
      coverImageMediaId: 'media-cover-1',
      coverImageMedia: { id: 'media-cover-1', url: '/m/episode-cover-1' },
      coverImageUrl: '/m/episode-cover-1',
    })
  })
})
