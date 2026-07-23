import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const transactionMock = vi.hoisted(() => vi.fn())
const episodeFindManyMock = vi.hoisted(() => vi.fn())
const episodeCountMock = vi.hoisted(() => vi.fn())
const episodeDeleteManyMock = vi.hoisted(() => vi.fn())
const episodeCreateMock = vi.hoisted(() => vi.fn())
const projectUpdateMock = vi.hoisted(() => vi.fn())
const deleteMediaObjectIfUnreferencedMock = vi.hoisted(() => vi.fn())
const logErrorMock = vi.hoisted(() => vi.fn())

const prismaMock = vi.hoisted(() => ({
  $transaction: transactionMock,
  novelPromotionProject: {
    findFirst: vi.fn(),
  },
  novelPromotionEpisode: {
    findMany: vi.fn(),
  },
  novelPromotionClip: {
    count: vi.fn(),
  },
  novelPromotionShot: {
    count: vi.fn(),
  },
  novelPromotionStoryboard: {
    count: vi.fn(),
  },
  novelPromotionPanel: {
    count: vi.fn(),
  },
  novelPromotionVoiceLine: {
    count: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireProjectAuthLight: async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/media/unreferenced-cleanup', () => ({
  deleteMediaObjectIfUnreferenced: deleteMediaObjectIfUnreferencedMock,
}))

vi.mock('@/lib/logging/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/logging/core')>(),
  logError: logErrorMock,
}))

describe('POST /novel-promotion/[projectId]/episodes/batch replace_all', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findFirst.mockResolvedValue({
      id: 'novel-project-1',
    })
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([])
    prismaMock.novelPromotionClip.count.mockResolvedValue(0)
    prismaMock.novelPromotionShot.count.mockResolvedValue(0)
    prismaMock.novelPromotionStoryboard.count.mockResolvedValue(0)
    prismaMock.novelPromotionPanel.count.mockResolvedValue(0)
    prismaMock.novelPromotionVoiceLine.count.mockResolvedValue(0)
    episodeFindManyMock.mockResolvedValue([])
    episodeCountMock.mockResolvedValue(2)
    episodeDeleteManyMock.mockResolvedValue({ count: 2 })
    episodeCreateMock.mockImplementation(async ({ data }) => ({
      id: `created-${data.episodeNumber}`,
      ...data,
    }))
    projectUpdateMock.mockResolvedValue({ id: 'novel-project-1' })
    deleteMediaObjectIfUnreferencedMock.mockResolvedValue('deleted')
    transactionMock.mockImplementation(async (callback) => await callback({
      novelPromotionEpisode: {
        findMany: episodeFindManyMock,
        count: episodeCountMock,
        deleteMany: episodeDeleteManyMock,
        create: episodeCreateMock,
      },
      novelPromotionProject: {
        update: projectUpdateMock,
      },
    }))
  })

  function request(confirmCascadeDelete = true) {
    return buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/batch',
      method: 'POST',
      body: {
        mode: 'replace_all',
        confirmReplace: true,
        confirmCascadeDelete,
        episodes: [
          { name: 'Replacement 1', novelText: 'One' },
          { name: 'Replacement 2', novelText: 'Two' },
        ],
      },
    })
  }

  it('requires cascade confirmation when an existing Episode has a cover', async () => {
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValueOnce([{
      id: 'episode-1',
      coverImageMediaId: 'media-cover-1',
    }])

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/batch/route')
    const response = await POST(request(false), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        details: {
          mode: 'replace_all',
          dependents: {
            covers: 1,
          },
        },
      },
    })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects an unconfirmed cover published after the outer precheck but before replacement writes', async () => {
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValueOnce([])
    episodeFindManyMock.mockResolvedValueOnce([{
      id: 'episode-1',
      coverImageMediaId: 'media-cover-current',
      coverImageMedia: { storageKey: 'episode-cover/current.png' },
    }])

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/batch/route')
    const response = await POST(request(false), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        details: {
          message: 'replace_all would delete existing generated content; confirmCascadeDelete=true is required',
          mode: 'replace_all',
          dependents: {
            covers: 1,
          },
        },
      },
    })
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
    expect(episodeDeleteManyMock).not.toHaveBeenCalled()
    expect(episodeCreateMock).not.toHaveBeenCalled()
    expect(projectUpdateMock).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
  })

  it('captures transaction-current covers, deduplicates them, and cleans only after commit', async () => {
    const events: string[] = []
    episodeFindManyMock.mockImplementationOnce(async () => {
      events.push('current-covers-read')
      return [
        {
          id: 'episode-1',
          coverImageMediaId: 'media-cover-current',
          coverImageMedia: { storageKey: 'episode-cover/current.png' },
        },
        {
          id: 'episode-2',
          coverImageMediaId: 'media-cover-current',
          coverImageMedia: { storageKey: 'episode-cover/current.png' },
        },
      ]
    })
    episodeDeleteManyMock.mockImplementationOnce(async () => {
      events.push('episodes-deleted')
      return { count: 2 }
    })
    transactionMock.mockImplementationOnce(async (callback) => {
      const result = await callback({
        novelPromotionEpisode: {
          findMany: episodeFindManyMock,
          count: episodeCountMock,
          deleteMany: episodeDeleteManyMock,
          create: episodeCreateMock,
        },
        novelPromotionProject: {
          update: projectUpdateMock,
        },
      })
      events.push('replace-transaction-committed')
      return result
    })
    deleteMediaObjectIfUnreferencedMock.mockImplementationOnce(async () => {
      events.push('cover-cleaned')
      return 'deleted'
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/batch/route')
    const response = await POST(request(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      mode: 'replace_all',
      replacedCount: 2,
    })
    expect(episodeFindManyMock).toHaveBeenCalledWith({
      where: { novelPromotionProjectId: 'novel-project-1' },
      select: {
        id: true,
        coverImageMediaId: true,
        coverImageMedia: { select: { storageKey: true } },
      },
    })
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenCalledTimes(1)
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenCalledWith('media-cover-current')
    expect(events).toEqual([
      'current-covers-read',
      'episodes-deleted',
      'replace-transaction-committed',
      'cover-cleaned',
    ])
  })

  it('logs cleanup errors, continues remaining covers, and returns committed replacement success', async () => {
    episodeFindManyMock.mockResolvedValueOnce([
      {
        id: 'episode-1',
        coverImageMediaId: 'media-cover-1',
        coverImageMedia: { storageKey: 'episode-cover/one.png' },
      },
      {
        id: 'episode-2',
        coverImageMediaId: 'media-cover-2',
        coverImageMedia: { storageKey: 'episode-cover/two.png' },
      },
    ])
    deleteMediaObjectIfUnreferencedMock
      .mockRejectedValueOnce(new Error('cleanup unavailable'))
      .mockResolvedValueOnce('deleted')

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/batch/route')
    const response = await POST(request(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      mode: 'replace_all',
      replacedCount: 2,
    })
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenNthCalledWith(1, 'media-cover-1')
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenNthCalledWith(2, 'media-cover-2')
    expect(logErrorMock).toHaveBeenCalledWith(
      'Episode cover cleanup failed after batch replacement',
      expect.objectContaining({
        projectId: 'project-1',
        episodeId: 'episode-1',
        mediaId: 'media-cover-1',
        storageKey: 'episode-cover/one.png',
        error: 'cleanup unavailable',
      }),
    )
  })
})
