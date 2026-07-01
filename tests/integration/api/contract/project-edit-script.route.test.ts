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

const submitOperationTaskMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  async: true,
  status: 'queued',
  taskId: 'task-edit-script',
  runId: null,
  deduped: false,
})))

const taskSubmissionMock = vi.hoisted(() => ({
  submitProjectEditScreenplayGenerationTask: vi.fn(async () => ({
    success: true,
    async: true,
    status: 'queued',
    taskId: 'task-screenplay',
    runId: null,
    deduped: false,
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    taskType: 'edit_screenplay_generate',
    targetType: 'ProjectEditScreenplay',
    targetId: 'screenplay-1',
  })),
  submitProjectEditShotExecutionPlanTask: vi.fn(async () => ({
    success: true,
    async: true,
    status: 'queued',
    taskId: 'task-shot-execution-plan',
    runId: null,
    deduped: false,
    episodeId: 'episode-1',
    editScriptId: 'edit-script-1',
    taskType: 'edit_shot_execution_plan_generate',
    targetType: 'ProjectEditScript',
    targetId: 'edit-script-1',
  })),
}))

const editScriptServiceMock = vi.hoisted(() => ({
  confirmProjectEditStylePreview: vi.fn(),
  readProjectEditScreenplay: vi.fn(),
  readProjectEditScript: vi.fn(),
  readProjectEditShotExecutionPlan: vi.fn(),
  updateProjectEditScriptAssetRequirementDescription: vi.fn(),
}))

const generationSegmentsMock = vi.hoisted(() => ({
  arrangeProjectEditScriptGenerationSegments: vi.fn(),
  mergeProjectEditScriptGenerationSegments: vi.fn(),
  updateProjectEditScriptGenerationSegmentContinuity: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/operations/submit-operation-task', () => ({
  submitOperationTask: submitOperationTaskMock,
}))
vi.mock('@/lib/edit-script/task-submission', () => taskSubmissionMock)
vi.mock('@/lib/edit-script/service', () => editScriptServiceMock)
vi.mock('@/lib/edit-script/generation-segments', () => generationSegmentsMock)

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>
}

type ProjectPostRoute = {
  POST: (request: ReturnType<typeof buildMockRequest>, context: ProjectRouteContext) => Promise<Response>
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json() as unknown
  expect(value).toEqual(expect.any(Object))
  return value as Record<string, unknown>
}

describe('api contract - project edit script routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.state.authenticated = true
  })

  it('POST /api/projects/[projectId]/edit-script submits the edit script generation task contract', async () => {
    const mod = await import('@/app/api/projects/[projectId]/edit-script/route') as ProjectPostRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
        videoRatio: '16:9',
      },
    })

    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      async: true,
      status: 'queued',
      taskId: 'task-edit-script',
    })
    expect(submitOperationTaskMock).toHaveBeenCalledWith({
      request: expect.any(Request),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      operationId: 'generate_edit_script',
      source: 'project-ui',
      confirmed: true,
      payload: {
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
        videoRatio: '16:9',
        displayMode: 'detail',
      },
      dedupeKey: 'edit_script_generate:project-1:episode-1',
      billingInfo: null,
      locale: 'zh',
    })
  })

  it('POST /api/projects/[projectId]/edit-script/screenplay submits the screenplay generation contract', async () => {
    const mod = await import('@/app/api/projects/[projectId]/edit-script/screenplay/route') as ProjectPostRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script/screenplay',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        prompt: '生成一个夜晚追逐短片',
        durationTier: 'medium',
        aspectRatio: '16:9',
      },
    })

    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      async: true,
      status: 'queued',
      taskId: 'task-screenplay',
      screenplayId: 'screenplay-1',
    })
    expect(taskSubmissionMock.submitProjectEditScreenplayGenerationTask).toHaveBeenCalledWith({
      request: expect.any(Request),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
      prompt: '生成一个夜晚追逐短片',
      durationTier: 'medium',
      aspectRatio: '16:9',
      source: 'project-ui',
      confirmed: true,
    })
  })

  it('POST /api/projects/[projectId]/edit-script/shot-execution-plan submits the shot execution plan contract', async () => {
    const mod = await import('@/app/api/projects/[projectId]/edit-script/shot-execution-plan/route') as ProjectPostRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script/shot-execution-plan',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        editScriptId: 'edit-script-1',
      },
    })

    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      async: true,
      status: 'queued',
      taskId: 'task-shot-execution-plan',
      editScriptId: 'edit-script-1',
    })
    expect(taskSubmissionMock.submitProjectEditShotExecutionPlanTask).toHaveBeenCalledWith({
      request: expect.any(Request),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
      editScriptId: 'edit-script-1',
    })
  })

  it('POST /api/projects/[projectId]/edit-script/screenplay rejects unauthenticated submissions without creating a task', async () => {
    authMock.state.authenticated = false
    const mod = await import('@/app/api/projects/[projectId]/edit-script/screenplay/route') as ProjectPostRoute
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script/screenplay',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        prompt: '生成一个夜晚追逐短片',
        durationTier: 'medium',
        aspectRatio: '16:9',
      },
    })

    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(401)
    expect(taskSubmissionMock.submitProjectEditScreenplayGenerationTask).not.toHaveBeenCalled()
  })
})
