import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>
}

const authState = vi.hoisted(() => ({ authenticated: true }))
const findUniqueMock = vi.hoisted(() => vi.fn())
const updateProjectMock = vi.hoisted(() => vi.fn())
const findManyTaskMock = vi.hoisted(() => vi.fn())
const findManyMediaObjectMock = vi.hoisted(() => vi.fn())
const attachMediaFieldsToProjectMock = vi.hoisted(() => vi.fn(async (value) => value))

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
    novelPromotionEpisode: {
      findUnique: findUniqueMock,
    },
    novelPromotionProject: {
      update: updateProjectMock,
    },
    task: {
      findMany: findManyTaskMock,
    },
    mediaObject: {
      findMany: findManyMediaObjectMock,
    },
  },
}))

vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: attachMediaFieldsToProjectMock,
}))

vi.mock('@/lib/media/service', () => ({
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))

describe('api contract - novel promotion episode profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    authState.authenticated = true
    updateProjectMock.mockResolvedValue({ projectId: 'project-1', lastEpisodeId: 'episode-1' })
    findManyTaskMock.mockResolvedValue([])
    findManyMediaObjectMock.mockResolvedValue([])
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
    expect(body.episode.artifactReadiness).toEqual({
      hasStory: true,
      hasScript: true,
      hasStoryboard: true,
      hasVideo: false,
      hasVoice: false,
    })
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        clips: expect.any(Object),
        storyboards: expect.any(Object),
      }),
    }))
    expect(findManyTaskMock).not.toHaveBeenCalled()
    expect(attachMediaFieldsToProjectMock).not.toHaveBeenCalled()
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
    findManyTaskMock.mockResolvedValue([])

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
})
