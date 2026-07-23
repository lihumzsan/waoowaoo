import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>
}

const authState = vi.hoisted(() => ({ authenticated: true }))
const findUniqueMock = vi.hoisted(() => vi.fn())
const findFirstMock = vi.hoisted(() => vi.fn())
const updateEpisodeMock = vi.hoisted(() => vi.fn())
const deleteEpisodeMock = vi.hoisted(() => vi.fn())
const updateProjectMock = vi.hoisted(() => vi.fn())
const findUniqueProjectMock = vi.hoisted(() => vi.fn())
const findManyTaskMock = vi.hoisted(() => vi.fn())
const findManyMediaObjectMock = vi.hoisted(() => vi.fn())
const deleteMediaObjectIfUnreferencedMock = vi.hoisted(() => vi.fn())
const transactionMock = vi.hoisted(() => vi.fn())
const logErrorMock = vi.hoisted(() => vi.fn())
const attachMediaFieldsToProjectMock = vi.hoisted(() => vi.fn(async (value) => value))
const attachMediaFieldsToEpisodeMock = vi.hoisted(() => vi.fn(async (value: Record<string, unknown>) => ({
  ...value,
  coverImageMedia: value.coverImageMediaId
    ? {
        id: value.coverImageMediaId,
        url: value.coverImageMediaId === 'media-project-b' ? '/m/project-b-cover' : '/m/episode-cover-1',
        storageKey: value.coverImageMediaId === 'media-project-b' ? 'private/project-b/cover.png' : undefined,
      }
    : null,
  coverImageUrl: value.coverImageMediaId === 'media-project-b'
    ? '/m/project-b-cover'
    : value.coverImageMediaId ? '/m/episode-cover-1' : null,
})))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireProjectAuthLight: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
    novelPromotionEpisode: {
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
      update: updateEpisodeMock,
      delete: deleteEpisodeMock,
    },
    novelPromotionProject: {
      update: updateProjectMock,
      findUnique: findUniqueProjectMock,
    },
    task: {
      findMany: findManyTaskMock,
    },
    mediaObject: {
      findMany: findManyMediaObjectMock,
    },
  },
}))

vi.mock('@/lib/logging/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/logging/core')>(),
  logError: logErrorMock,
}))

vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToEpisode: attachMediaFieldsToEpisodeMock,
  attachMediaFieldsToProject: attachMediaFieldsToProjectMock,
}))

vi.mock('@/lib/media/service', () => ({
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))

vi.mock('@/lib/media/unreferenced-cleanup', () => ({
  deleteMediaObjectIfUnreferenced: deleteMediaObjectIfUnreferencedMock,
}))

describe('api contract - novel promotion episode profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    authState.authenticated = true
    findFirstMock.mockImplementation((...args) => findUniqueMock(...args))
    updateEpisodeMock.mockResolvedValue({ id: 'episode-1', name: 'Updated Episode' })
    deleteEpisodeMock.mockResolvedValue({ id: 'episode-1' })
    updateProjectMock.mockResolvedValue({ projectId: 'project-1', lastEpisodeId: 'episode-1' })
    findUniqueProjectMock.mockResolvedValue(null)
    findManyTaskMock.mockResolvedValue([
      {
        id: 'task-current',
        targetId: 'panel-1',
        payload: {
          videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        },
        result: {
          videoUrl: '/m/video',
        },
      },
    ])
    findManyMediaObjectMock.mockResolvedValue([])
    deleteMediaObjectIfUnreferencedMock.mockResolvedValue('deleted')
    transactionMock.mockImplementation(async (callback) => await callback({
      novelPromotionEpisode: {
        findFirst: findFirstMock,
        delete: deleteEpisodeMock,
      },
      novelPromotionProject: {
        findUnique: findUniqueProjectMock,
        update: updateProjectMock,
      },
    }))
  })

  it('keeps the default full profile compatible and adds artifactReadiness', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'episode-1',
      episodeNumber: 1,
      name: 'Episode 1',
      novelText: 'story',
      audioUrl: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      clips: [
        { id: 'clip-1', summary: '', location: null, characters: null, props: null, content: 'c', screenplay: '{"scenes":[]}' },
      ],
      storyboards: [
        {
          id: 'sb-1',
          episodeId: 'episode-1',
          clipId: 'clip-1',
          panels: [{ id: 'panel-1', panelIndex: 0, videoUrl: 'https://example.com/video.mp4' }],
        },
      ],
      shots: [],
      voiceLines: [{ id: 'voice-1' }],
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/episode-1',
      method: 'GET',
    })

    const res = await route.GET(req, {
      params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
    } as RouteContext)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.episode.voiceLines).toEqual([{ id: 'voice-1' }])
    expect(body.episode.artifactReadiness).toEqual({
      hasStory: true,
      hasScript: true,
      hasStoryboard: true,
      hasVideo: true,
      hasVoice: true,
    })
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        voiceLines: expect.any(Object),
        shots: expect.any(Object),
      }),
    }))
    expect(attachMediaFieldsToProjectMock).toHaveBeenCalledTimes(1)
  })

  it('returns the config profile without heavy arrays', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'episode-1',
      episodeNumber: 1,
      name: 'Episode 1',
      novelText: 'story',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      clips: [{ id: 'clip-1', screenplay: '{"scenes":[]}' }],
      storyboards: [{ id: 'sb-1', panels: [{ id: 'panel-1', videoUrl: null }] }],
      voiceLines: [{ id: 'voice-1' }],
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/episode-1?profile=config',
      method: 'GET',
    })

    const res = await route.GET(req, {
      params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
    } as RouteContext)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.episode).toMatchObject({
      id: 'episode-1',
      name: 'Episode 1',
      novelText: 'story',
      artifactReadiness: {
        hasStory: true,
        hasScript: true,
        hasStoryboard: true,
        hasVideo: false,
        hasVoice: true,
      },
    })
    expect(body.episode.clips).toBeUndefined()
    expect(body.episode.storyboards).toBeUndefined()
    expect(body.episode.voiceLines).toBeUndefined()
    expect(attachMediaFieldsToProjectMock).not.toHaveBeenCalled()
  })

  it('returns the storyboard profile without voiceLines, shots, novelText, or video history', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'episode-1',
      episodeNumber: 1,
      name: 'Episode 1',
      description: null,
      coverImageMediaId: 'media-cover-1',
      novelText: 'long story text',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      clips: [
        { id: 'clip-1', summary: '', location: null, characters: null, props: null, content: 'c', screenplay: '{"scenes":[]}' },
      ],
      storyboards: [
        {
          id: 'sb-1',
          episodeId: 'episode-1',
          clipId: 'clip-1',
          clip: { id: 'clip-1', content: 'c' },
          panels: [{ id: 'panel-1', panelIndex: 0, imageUrl: '/m/image', videoUrl: '' }],
        },
      ],
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/episode-1?profile=storyboard',
      method: 'GET',
    })

    const res = await route.GET(req, {
      params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
    } as RouteContext)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.episode.clips).toHaveLength(1)
    expect(body.episode.storyboards).toHaveLength(1)
    expect(body.episode.novelText).toBeUndefined()
    expect(body.episode.voiceLines).toBeUndefined()
    expect(body.episode.shots).toBeUndefined()
    expect(body.episode.storyboards[0].panels[0].hasPreviousVideoVersion).toBeUndefined()
    expect(body.episode).toMatchObject({
      coverImageMediaId: 'media-cover-1',
      coverImageUrl: '/m/episode-cover-1',
    })
    expect(body.episode.artifactReadiness).toEqual({
      hasStory: true,
      hasScript: true,
      hasStoryboard: true,
      hasVideo: false,
      hasVoice: false,
    })
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        coverImageMediaId: true,
        clips: expect.any(Object),
        storyboards: expect.any(Object),
      }),
    }))
    expect(findManyTaskMock).not.toHaveBeenCalled()
    expect(attachMediaFieldsToProjectMock).not.toHaveBeenCalled()
    expect(attachMediaFieldsToEpisodeMock).toHaveBeenCalledTimes(1)
  })

  it('keeps workspace-visual as a storyboard-compatible alias', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'episode-1',
      episodeNumber: 1,
      name: 'Episode 1',
      description: null,
      novelText: 'long story text',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      clips: [],
      storyboards: [],
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/episode-1?profile=workspace-visual',
      method: 'GET',
    })

    const res = await route.GET(req, {
      params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
    } as RouteContext)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.episode.novelText).toBeUndefined()
  })

  it('returns videos profile with previous video availability checks', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'episode-1',
      episodeNumber: 1,
      name: 'Episode 1',
      description: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      clips: [],
      storyboards: [
        {
          id: 'sb-1',
          panels: [{ id: 'panel-1', panelIndex: 0, videoUrl: '/m/video' }],
        },
      ],
    })
    findManyTaskMock.mockResolvedValue([
      {
        id: 'task-current',
        targetId: 'panel-1',
        payload: {
          videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        },
        result: {
          videoUrl: '/m/video',
        },
      },
    ])

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/episode-1?profile=videos',
      method: 'GET',
    })

    const res = await route.GET(req, {
      params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
    } as RouteContext)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.episode.storyboards[0].panels[0].hasPreviousVideoVersion).toBe(false)
    expect(body.episode.storyboards[0].panels[0].videoModel).toBe('comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2')
    expect(findManyTaskMock).toHaveBeenCalledTimes(1)
  })

  it('returns voice profile with only bindable panel data and readiness', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'episode-1',
      episodeNumber: 1,
      name: 'Episode 1',
      description: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      clips: [{ id: 'clip-1', summary: 'summary', content: 'content', screenplay: '{"scenes":[]}' }],
      storyboards: [
        {
          id: 'sb-1',
          episodeId: 'episode-1',
          clipId: 'clip-1',
          panels: [{ id: 'panel-1', panelIndex: 0, description: 'desc', srtSegment: 'line' }],
        },
      ],
      voiceLines: [{ id: 'voice-1' }],
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/episode-1?profile=voice',
      method: 'GET',
    })

    const res = await route.GET(req, {
      params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
    } as RouteContext)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.episode.storyboards[0].panels[0]).toEqual(expect.objectContaining({
      id: 'panel-1',
      panelIndex: 0,
      description: 'desc',
      srtSegment: 'line',
    }))
    expect(body.episode.shots).toBeUndefined()
    expect(body.episode.artifactReadiness.hasVoice).toBe(true)
  })

  it.each([
    ['full', ''],
    ['config', '?profile=config'],
    ['storyboard', '?profile=storyboard'],
    ['workspace-visual', '?profile=workspace-visual'],
    ['videos', '?profile=videos'],
    ['voice', '?profile=voice'],
  ])('returns 404 instead of loading Project B through the %s profile', async (_profile, query) => {
    findUniqueMock.mockResolvedValue({
      id: 'episode-project-b',
      episodeNumber: 2,
      name: 'Project B Episode',
      description: null,
      coverImageMediaId: 'media-project-b',
      coverImage: 'https://storage.example/private/project-b/cover.png',
      novelText: 'Project B story',
      createdAt: new Date('2026-04-02T00:00:00.000Z'),
      updatedAt: new Date('2026-04-02T00:00:00.000Z'),
      clips: [],
      storyboards: [],
      shots: [],
      voiceLines: [],
    })
    findFirstMock.mockResolvedValueOnce(null)

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: `/api/novel-promotion/project-a/episodes/episode-project-b${query}`,
      method: 'GET',
    })

    const res = await route.GET(req, {
      params: Promise.resolve({ projectId: 'project-a', episodeId: 'episode-project-b' }),
    } as RouteContext)
    const body = await res.json()
    const serializedBody = JSON.stringify(body)

    expect(res.status).toBe(404)
    expect(serializedBody).not.toContain('media-project-b')
    expect(serializedBody).not.toContain('/m/project-b-cover')
    expect(serializedBody).not.toContain('private/project-b/cover.png')
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'episode-project-b',
        novelPromotionProject: { projectId: 'project-a' },
      },
    }))
  })

  it('returns 404 without updating an Episode from Project B', async () => {
    findFirstMock.mockResolvedValueOnce(null)

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-a/episodes/episode-project-b',
      method: 'PATCH',
      body: { name: 'Cross-project update' },
    })

    const res = await route.PATCH(req, {
      params: Promise.resolve({ projectId: 'project-a', episodeId: 'episode-project-b' }),
    } as RouteContext)

    expect(res.status).toBe(404)
    expect(updateEpisodeMock).not.toHaveBeenCalled()
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'episode-project-b',
        novelPromotionProject: { projectId: 'project-a' },
      },
      select: { id: true },
    })
  })

  it('returns 404 without deleting an Episode from Project B', async () => {
    findFirstMock.mockResolvedValueOnce(null)

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-a/episodes/episode-project-b',
      method: 'DELETE',
    })

    const res = await route.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-a', episodeId: 'episode-project-b' }),
    } as RouteContext)

    expect(res.status).toBe(404)
    expect(deleteEpisodeMock).not.toHaveBeenCalled()
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'episode-project-b',
        novelPromotionProject: { projectId: 'project-a' },
      },
      select: {
        id: true,
        coverImageMediaId: true,
        coverImageMedia: { select: { storageKey: true } },
      },
    })
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
  })

  it('captures the current cover and maintains lastEpisodeId in the delete transaction before cleanup', async () => {
    const events: string[] = []
    findFirstMock.mockImplementationOnce(async () => {
      events.push('current-cover-read')
      return {
      id: 'episode-1',
      coverImageMediaId: 'media-cover-1',
        coverImageMedia: { storageKey: 'episode-cover/current.png' },
      }
    })
    deleteEpisodeMock.mockImplementationOnce(async () => {
      events.push('episode-deleted')
      return { id: 'episode-1' }
    })
    deleteMediaObjectIfUnreferencedMock.mockImplementationOnce(async () => {
      events.push('cover-cleaned')
      return 'deleted'
    })
    findUniqueProjectMock.mockResolvedValueOnce({
      id: 'novel-project-1',
      lastEpisodeId: 'episode-1',
    })
    findFirstMock.mockImplementationOnce(async () => {
      events.push('replacement-episode-read')
      return { id: 'episode-2' }
    })
    updateProjectMock.mockImplementationOnce(async () => {
      events.push('last-episode-updated')
      return { id: 'novel-project-1' }
    })
    transactionMock.mockImplementationOnce(async (callback) => {
      const result = await callback({
        novelPromotionEpisode: {
          findFirst: findFirstMock,
          delete: deleteEpisodeMock,
        },
        novelPromotionProject: {
          findUnique: findUniqueProjectMock,
          update: updateProjectMock,
        },
      })
      events.push('delete-transaction-committed')
      return result
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/episode-1',
      method: 'DELETE',
    })

    const res = await route.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
    } as RouteContext)

    expect(res.status).toBe(200)
    expect(findFirstMock).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'episode-1',
        novelPromotionProject: { projectId: 'project-1' },
      },
      select: {
        id: true,
        coverImageMediaId: true,
        coverImageMedia: { select: { storageKey: true } },
      },
    })
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenCalledWith('media-cover-1')
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
    expect(events).toEqual([
      'current-cover-read',
      'episode-deleted',
      'replacement-episode-read',
      'last-episode-updated',
      'delete-transaction-committed',
      'cover-cleaned',
    ])
  })

  it('returns success and reports a structured failure when cover cleanup fails after deletion', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'episode-1',
      coverImageMediaId: 'media-cover-1',
      coverImageMedia: { storageKey: 'episode-cover/current.png' },
    })
    findUniqueProjectMock.mockResolvedValueOnce(null)
    deleteMediaObjectIfUnreferencedMock.mockRejectedValueOnce(new Error('database unavailable'))

    const route = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes/episode-1',
      method: 'DELETE',
    })

    const res = await route.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
    } as RouteContext)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      coverMediaCleanupFailed: 1,
    })
    expect(logErrorMock).toHaveBeenCalledWith(
      'Episode cover cleanup failed after Episode deletion',
      expect.objectContaining({
        projectId: 'project-1',
        episodeId: 'episode-1',
        mediaId: 'media-cover-1',
        storageKey: 'episode-cover/current.png',
      }),
    )
  })
})
