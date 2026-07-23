import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  mediaObject: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/storage', () => ({
  extractStorageKey: (value: string) => {
    if (value.startsWith('/api/files/')) {
      return decodeURIComponent(value.replace('/api/files/', ''))
    }
    return value
  },
}))

const modernAudioRow = {
  id: 'media-audio-1',
  publicId: 'episode-audio/public-1',
  sha256: 'audio-sha',
  mimeType: 'audio/mpeg',
  sizeBytes: 2048,
  width: null,
  height: null,
  durationMs: 1200,
  updatedAt: '2026-07-23T00:00:00.000Z',
  storageKey: 'episode-audio/audio-1.mp3',
}

const coverRow = {
  id: 'media-cover-1',
  publicId: 'episode-cover/public-1',
  sha256: 'cover-sha',
  mimeType: 'image/png',
  sizeBytes: 1024,
  width: 1280,
  height: 720,
  durationMs: null,
  updatedAt: '2026-07-23T00:00:00.000Z',
  storageKey: 'episode-cover/cover-1.png',
}

const legacyAudioRow = {
  ...modernAudioRow,
  id: 'media-audio-legacy',
  publicId: 'episode-audio/legacy',
  storageKey: 'episode-audio/legacy.mp3',
}

function buildEpisodes(count: number) {
  return Array.from({ length: count }, (_, index) => (
    index % 2 === 0
      ? {
        id: `episode-${index + 1}`,
        episodeNumber: index + 1,
        name: `Episode ${index + 1}`,
        audioMediaId: modernAudioRow.id,
        audioUrl: 'episode-audio/legacy-should-not-win.mp3',
        coverImageMediaId: coverRow.id,
        clips: [],
        storyboards: [],
        voiceLines: [],
      }
      : {
        id: `episode-${index + 1}`,
        episodeNumber: index + 1,
        name: `Episode ${index + 1}`,
        audioMediaId: null,
        audioUrl: '/api/files/%2Fepisode-audio%2Flegacy.mp3',
        coverImageMediaId: 'missing-cover',
        coverImageUrl: 'https://legacy.example/cover.png',
        clips: [],
        storyboards: [],
        voiceLines: [],
      }
  ))
}

function mediaQueryCount() {
  return prismaMock.mediaObject.findMany.mock.calls.length
    + prismaMock.mediaObject.findUnique.mock.calls.length
    + prismaMock.mediaObject.upsert.mock.calls.length
}

async function loadProjectData(episodeCount: number) {
  prismaMock.mediaObject.findMany.mockClear()
  prismaMock.mediaObject.findUnique.mockClear()
  prismaMock.mediaObject.upsert.mockClear()
  prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
    id: 'novel-data-1',
    projectId: 'project-1',
    episodes: buildEpisodes(episodeCount),
  })

  const route = await import('@/app/api/projects/[projectId]/data/route')
  const response = await route.GET(
    buildMockRequest({
      path: '/api/projects/project-1/data',
      method: 'GET',
    }),
    {
      params: Promise.resolve({ projectId: 'project-1' }),
    },
  )

  return {
    response,
    body: await response.json(),
    queryCount: mediaQueryCount(),
  }
}

describe('Project data Episode media query contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      name: 'Project 1',
    })
    prismaMock.project.update.mockResolvedValue({
      id: 'project-1',
    })
    prismaMock.mediaObject.findMany.mockImplementation(async (args: {
      where?: {
        id?: { in?: string[] }
        storageKey?: { in?: string[] }
      }
    }) => {
      const ids = args.where?.id?.in || []
      if (ids.length > 0) {
        return [modernAudioRow, coverRow].filter((row) => ids.includes(row.id))
      }
      const storageKeys = args.where?.storageKey?.in || []
      return storageKeys.includes(legacyAudioRow.storageKey) ? [legacyAudioRow] : []
    })
    prismaMock.mediaObject.findUnique.mockImplementation(async (args: {
      where?: {
        id?: string
        storageKey?: string
      }
    }) => {
      if (args.where?.id === modernAudioRow.id) return modernAudioRow
      if (args.where?.id === coverRow.id) return coverRow
      if (args.where?.storageKey === legacyAudioRow.storageKey) return legacyAudioRow
      return null
    })
  })

  it('keeps nested Episode media fields while media query count stays constant as Episode count grows', async () => {
    const small = await loadProjectData(4)
    const smallEpisodes = small.body.project.novelPromotionData.episodes

    expect(small.response.status).toBe(200)
    expect(small.queryCount).toBe(2)
    expect(prismaMock.mediaObject.findMany).toHaveBeenCalledTimes(2)
    expect(prismaMock.mediaObject.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [modernAudioRow.id, coverRow.id, 'missing-cover'],
        },
      },
    })
    expect(prismaMock.mediaObject.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: {
          in: [modernAudioRow.id, coverRow.id, 'missing-cover'],
        },
      },
    })
    expect(prismaMock.mediaObject.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        storageKey: {
          in: [legacyAudioRow.storageKey],
        },
      },
    })
    expect(prismaMock.mediaObject.findUnique).not.toHaveBeenCalled()
    expect(smallEpisodes[0]).toMatchObject({
      audioMedia: {
        id: modernAudioRow.id,
        url: '/m/episode-audio%2Fpublic-1',
      },
      audioUrl: '/m/episode-audio%2Fpublic-1',
      coverImageMedia: {
        id: coverRow.id,
        url: '/m/episode-cover%2Fpublic-1',
      },
      coverImageUrl: '/m/episode-cover%2Fpublic-1',
    })
    expect(smallEpisodes[1]).toMatchObject({
      audioMedia: {
        id: legacyAudioRow.id,
        url: '/m/episode-audio%2Flegacy',
      },
      audioUrl: '/m/episode-audio%2Flegacy',
      coverImageMedia: null,
      coverImageUrl: null,
    })

    const large = await loadProjectData(40)

    expect(large.response.status).toBe(200)
    expect(large.queryCount).toBe(small.queryCount)
    expect(prismaMock.mediaObject.findMany).toHaveBeenCalledTimes(2)
    expect(prismaMock.mediaObject.findUnique).not.toHaveBeenCalled()
    expect(large.body.project.novelPromotionData.episodes).toHaveLength(40)
  })
})
