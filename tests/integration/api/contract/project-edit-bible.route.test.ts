import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => {
  const state = { authenticated: true }
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  const requireProjectAuth = vi.fn(async (projectId: string) => {
    if (!state.authenticated) return unauthorized()
    return {
      session: { user: { id: 'user-1' } },
      project: { id: projectId, userId: 'user-1' },
    }
  })

  const requireProjectAuthLight = vi.fn(async (projectId: string) => {
    if (!state.authenticated) return unauthorized()
    return {
      session: { user: { id: 'user-1' } },
      project: { id: projectId, userId: 'user-1' },
    }
  })

  return {
    state,
    isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
    requireProjectAuth,
    requireProjectAuthLight,
  }
})

const editBibleMock = vi.hoisted(() => ({
  submitProjectEditBibleGenerationTask: vi.fn(async () => ({
    success: true,
    async: true,
    status: 'queued',
    taskId: 'task-bible',
    runId: null,
    deduped: false,
    episodeId: 'episode-1',
    sourceDocumentId: 'source-1',
    editBibleId: 'bible-1',
    taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
    targetType: 'ProjectEditBible',
    targetId: 'bible-1',
  })),
  readEpisodeEditBible: vi.fn(async () => ({
    id: 'bible-1',
    status: 'ready_for_review',
  })),
  readEpisodeEditChapters: vi.fn(async () => ([{
    id: 'chapter-1',
    chapterIndex: 0,
    title: '开场',
  }])),
  confirmEpisodeEditBible: vi.fn(async () => ({
    id: 'bible-1',
    status: 'confirmed',
  })),
  reviseEpisodeEditBible: vi.fn(async () => ({
    editBible: {
      id: 'bible-1',
      status: 'ready_for_review',
    },
    chapters: [],
  })),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/edit-bible', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/edit-bible')>()),
  submitProjectEditBibleGenerationTask: editBibleMock.submitProjectEditBibleGenerationTask,
  readEpisodeEditBible: editBibleMock.readEpisodeEditBible,
  readEpisodeEditChapters: editBibleMock.readEpisodeEditChapters,
  confirmEpisodeEditBible: editBibleMock.confirmEpisodeEditBible,
  reviseEpisodeEditBible: editBibleMock.reviseEpisodeEditBible,
}))

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>
}

type ProjectBibleRoute = {
  GET: (request: ReturnType<typeof buildMockRequest>, context: ProjectRouteContext) => Promise<Response>
  POST: (request: ReturnType<typeof buildMockRequest>, context: ProjectRouteContext) => Promise<Response>
  PATCH: (request: ReturnType<typeof buildMockRequest>, context: ProjectRouteContext) => Promise<Response>
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as unknown
  expect(value).toEqual(expect.any(Object))
  return value as Record<string, unknown>
}

describe('api contract - project edit bible routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.state.authenticated = true
  })

  it('POST /api/projects/[projectId]/bible submits the edit bible generation task contract', async () => {
    const mod = await import('@/app/api/projects/[projectId]/bible/route') as ProjectBibleRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/bible',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        sourceKind: 'paste',
        text: '一万字剧本片段',
      },
    })

    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      async: true,
      status: 'queued',
      taskId: 'task-bible',
      editBibleId: 'bible-1',
      taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
    })
    expect(editBibleMock.submitProjectEditBibleGenerationTask).toHaveBeenCalledWith({
      request: expect.any(Request),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      sourceKind: 'paste',
      text: '一万字剧本片段',
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
    })
  })

  it('GET /api/projects/[projectId]/bible requires explicit episodeId', async () => {
    const mod = await import('@/app/api/projects/[projectId]/bible/route') as ProjectBibleRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/bible',
      method: 'GET',
    })

    const response = await mod.GET(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(400)
    expect(editBibleMock.readEpisodeEditBible).not.toHaveBeenCalled()
  })

  it('GET /api/projects/[projectId]/bible returns bible and chapters for the episode', async () => {
    const mod = await import('@/app/api/projects/[projectId]/bible/route') as ProjectBibleRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/bible?episodeId=episode-1',
      method: 'GET',
    })

    const response = await mod.GET(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      editBible: { id: 'bible-1' },
      chapters: [{ id: 'chapter-1' }],
    })
  })

  it('PATCH /api/projects/[projectId]/bible confirms the ready bible', async () => {
    const mod = await import('@/app/api/projects/[projectId]/bible/route') as ProjectBibleRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/bible',
      method: 'PATCH',
      body: {
        action: 'confirm',
        episodeId: 'episode-1',
      },
    })

    const response = await mod.PATCH(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      editBible: { status: 'confirmed' },
    })
    expect(editBibleMock.confirmEpisodeEditBible).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
  })

  it('PATCH /api/projects/[projectId]/bible applies reviewed bible revisions', async () => {
    const mod = await import('@/app/api/projects/[projectId]/bible/route') as ProjectBibleRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/bible',
      method: 'PATCH',
      body: {
        action: 'revise',
        episodeId: 'episode-1',
        bible: {
          synopsis: '修订后的梗概',
          characters: [],
          locations: [],
          worldRules: [],
          styleGuide: {},
        },
      },
    })

    const response = await mod.PATCH(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(editBibleMock.reviseEpisodeEditBible).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      patch: {
        bible: {
          synopsis: '修订后的梗概',
          characters: [],
          locations: [],
          worldRules: [],
          styleGuide: {},
        },
      },
    })
  })
})
