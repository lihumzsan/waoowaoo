import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const serviceMock = vi.hoisted(() => ({
  readProjectEditScreenplay: vi.fn(async () => null),
  generateProjectEditScreenplay: vi.fn(async () => ({
    id: 'screenplay-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    styleBible: null,
    stylePreviews: [],
    screenplayText: 'screenplay',
    status: 'screenplay_ready',
  })),
  readProjectEditScript: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    title: 'Orbital Silence',
    logline: 'A pilot meets a machine intelligence.',
    durationSec: 60,
    shotCount: 8,
    status: 'ready',
    shots: [],
    requirements: [],
  })),
  generateProjectEditScript: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    title: 'Orbital Silence',
    logline: 'A pilot meets a machine intelligence.',
    durationSec: 60,
    shotCount: 8,
    status: 'ready',
    shots: [],
    requirements: [
      {
        id: 'req-1',
        kind: 'character',
        name: 'Pilot',
        description: 'A quiet astronaut.',
        shotNumbers: [1, 2],
        status: 'pending',
        targetId: null,
        errorMessage: null,
      },
    ],
  })),
  generateProjectEditScriptAssets: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    title: 'Orbital Silence',
    logline: 'A pilot meets a machine intelligence.',
    durationSec: 60,
    shotCount: 8,
    status: 'ready',
    shots: [],
    requirements: [
      {
        id: 'req-1',
        kind: 'character',
        name: 'Pilot',
        description: 'A quiet astronaut.',
        shotNumbers: [1, 2],
        status: 'generating',
        targetId: 'character-1',
        errorMessage: null,
      },
    ],
  })),
  updateProjectEditScriptVideoBlockPrompt: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    title: 'Orbital Silence',
    logline: 'A pilot meets a machine intelligence.',
    durationSec: 60,
    shotCount: 8,
    status: 'ready',
    shots: [],
    videoBlocks: [
      {
        kind: 'group',
        shotNumbers: [1, 2, 3],
        gridMode: '2x2',
        reason: 'continuous motion',
        prompt: 'updated combined prompt',
      },
    ],
    requirements: [],
  })),
  updateProjectEditScriptAssetRequirementDescription: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    title: 'Orbital Silence',
    logline: 'A pilot meets a machine intelligence.',
    durationSec: 60,
    shotCount: 8,
    status: 'ready',
    shots: [],
    videoBlocks: [],
    requirements: [
      {
        id: 'req-1',
        kind: 'character',
        name: 'Pilot',
        description: 'updated asset prompt',
        shotNumbers: [1, 2],
        status: 'pending',
        targetId: null,
        errorMessage: null,
      },
    ],
  })),
  confirmProjectEditStylePreview: vi.fn(async () => ({
    id: 'screenplay-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    styleBible: null,
    stylePreviews: [],
    screenplayText: 'screenplay',
    status: 'ready',
  })),
}))

const videoBlockMergeMock = vi.hoisted(() => ({
  mergeProjectEditScriptVideoBlocks: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    title: 'Orbital Silence',
    logline: 'A pilot meets a machine intelligence.',
    durationSec: 60,
    shotCount: 8,
    status: 'ready',
    shots: [],
    videoBlocks: [
      {
        kind: 'group',
        shotNumbers: [1, 2, 3, 4],
        gridMode: '2x2',
        reason: 'merged continuous motion',
        prompt: 'merged continuous prompt',
      },
    ],
    requirements: [],
  })),
}))

const videoBlockArrangementMock = vi.hoisted(() => ({
  arrangeProjectEditScriptVideoBlocks: vi.fn(async () => ({
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'one minute sci-fi',
    title: 'Orbital Silence',
    logline: 'A pilot meets a machine intelligence.',
    durationSec: 60,
    shotCount: 8,
    status: 'ready',
    shots: [],
    videoBlocks: [
      {
        kind: 'group',
        shotNumbers: [1, 2, 3],
        gridMode: '2x2',
        reason: 'manual adjacent arrangement',
        prompt: 'rewritten adjacent prompt',
      },
    ],
    requirements: [],
  })),
}))

const storyboardConsistencyServiceMock = vi.hoisted(() => ({
  submitEditScriptSpatialBlockingStoryboard: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-storyboard-1',
    runId: null,
    status: 'queued',
    deduped: false,
  })),
  submitEditScriptStoryboardPanels: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-panels-1',
    runId: null,
    status: 'queued',
    deduped: false,
  })),
}))

const submitOperationTaskMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  async: true,
  taskId: 'task-edit-script-1',
  runId: null,
  status: 'queued',
  deduped: false,
})))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  const authResult = (projectId: string) => {
    if (!authState.authenticated) return unauthorized()
    return {
      session: { user: { id: 'user-1' } },
      project: { id: projectId, userId: 'user-1' },
    }
  }

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireProjectAuth: async (projectId: string) => authResult(projectId),
    requireProjectAuthLight: async (projectId: string) => authResult(projectId),
  }
})

vi.mock('@/lib/edit-script/service', () => serviceMock)
vi.mock('@/lib/edit-script/video-block-arrangement', () => videoBlockArrangementMock)
vi.mock('@/lib/edit-script/video-block-merge', () => videoBlockMergeMock)
vi.mock('@/lib/edit-script/storyboard-consistency/service', () => storyboardConsistencyServiceMock)
vi.mock('@/lib/operations/submit-operation-task', () => ({
  submitOperationTask: submitOperationTaskMock,
}))

import {
  GET as editScriptGet,
  PATCH as editScriptPatch,
  POST as editScriptPost,
} from '@/app/api/projects/[projectId]/edit-script/route'
import {
  PATCH as editScreenplayPatch,
} from '@/app/api/projects/[projectId]/edit-script/screenplay/route'
import { TASK_TYPE } from '@/lib/task/types'
import {
  POST as editScriptAssetsGeneratePost,
} from '@/app/api/projects/[projectId]/edit-script/assets/generate/route'
import {
  POST as editScriptStoryboardGeneratePost,
} from '@/app/api/projects/[projectId]/edit-script/storyboard/generate/route'
import {
  POST as editScriptStoryboardSpatialBlockingGeneratePost,
} from '@/app/api/projects/[projectId]/edit-script/storyboard/spatial-blocking/generate/route'

describe('project edit script route', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('PATCH /api/projects/[projectId]/edit-script/screenplay -> confirms style with user-selected aspect ratio', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script/screenplay',
      method: 'PATCH',
      body: {
        episodeId: 'episode-1',
        stylePreviewId: 'style-preview-1',
        aspectRatio: '21:9',
      },
    })

    const response = await editScreenplayPatch(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.screenplay?.status).toBe('ready')
    expect(serviceMock.confirmProjectEditStylePreview).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      stylePreviewId: 'style-preview-1',
      aspectRatio: '21:9',
    })
  })

  it('POST /api/projects/[projectId]/edit-script -> submits async edit-script task so canvas can render progress states', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
        videoRatio: '16:9',
      },
    })

    const response = await editScriptPost(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      async: true,
      taskId: 'task-edit-script-1',
      runId: null,
      status: 'queued',
      deduped: false,
    })
    expect(serviceMock.generateProjectEditScript).not.toHaveBeenCalled()
    expect(submitOperationTaskMock).toHaveBeenCalledTimes(1)
    expect(submitOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      operationId: 'generate_edit_script',
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
        videoRatio: '16:9',
        displayMode: 'detail',
      }),
      dedupeKey: 'edit_script_generate:project-1:episode-1',
    }))
  })

  it('GET /api/projects/[projectId]/edit-script -> returns the persisted edit table and requirements', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script?episodeId=episode-1',
      method: 'GET',
    })

    const response = await editScriptGet(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.editScript.title).toBe('Orbital Silence')
    expect(serviceMock.readProjectEditScript).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
  })

  it('POST /api/projects/[projectId]/edit-script/assets/generate -> submits required character and location asset generation', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script/assets/generate',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        episodeId: 'episode-1',
        editScriptId: 'edit-1',
        requirementId: 'req-1',
      },
    })

    const response = await editScriptAssetsGeneratePost(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.editScript.requirements[0].status).toBe('generating')
    expect(serviceMock.generateProjectEditScriptAssets).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      requirementId: 'req-1',
      userId: 'user-1',
      locale: 'zh',
    }))
  })

  it('POST /api/projects/[projectId]/edit-script/storyboard/spatial-blocking/generate -> submits spatial blocking storyboard preparation', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script/storyboard/spatial-blocking/generate',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        episodeId: 'episode-1',
        editScriptId: 'edit-1',
      },
    })

    const response = await editScriptStoryboardSpatialBlockingGeneratePost(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      async: true,
      taskId: 'task-storyboard-1',
      runId: null,
      status: 'queued',
      deduped: false,
    })
    expect(storyboardConsistencyServiceMock.submitEditScriptSpatialBlockingStoryboard).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      userId: 'user-1',
      locale: 'zh',
    }))
  })

  it('POST /api/projects/[projectId]/edit-script/storyboard/generate -> submits storyboard panel generation', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script/storyboard/generate',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        episodeId: 'episode-1',
        editScriptId: 'edit-1',
      },
    })

    const response = await editScriptStoryboardGeneratePost(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      async: true,
      taskId: 'task-panels-1',
      runId: null,
      status: 'queued',
      deduped: false,
    })
    expect(storyboardConsistencyServiceMock.submitEditScriptStoryboardPanels).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      userId: 'user-1',
      locale: 'zh',
    }))
  })

  it('PATCH /api/projects/[projectId]/edit-script -> updates one video arrangement prompt', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script',
      method: 'PATCH',
      body: {
        episodeId: 'episode-1',
        editScriptId: 'edit-1',
        blockIndex: 0,
        prompt: 'updated combined prompt',
      },
    })

    const response = await editScriptPatch(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.editScript.videoBlocks[0].prompt).toBe('updated combined prompt')
    expect(serviceMock.updateProjectEditScriptVideoBlockPrompt).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blockIndex: 0,
      prompt: 'updated combined prompt',
    })
  })

  it('PATCH /api/projects/[projectId]/edit-script -> merges two adjacent video blocks', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script',
      method: 'PATCH',
      headers: { 'accept-language': 'zh' },
      body: {
        operation: 'mergeVideoBlocks',
        episodeId: 'episode-1',
        editScriptId: 'edit-1',
        leftBlockIndex: 0,
        rightBlockIndex: 1,
      },
    })

    const response = await editScriptPatch(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.editScript.videoBlocks[0].shotNumbers).toEqual([1, 2, 3, 4])
    expect(videoBlockMergeMock.mergeProjectEditScriptVideoBlocks).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      leftBlockIndex: 0,
      rightBlockIndex: 1,
      userId: 'user-1',
      locale: 'zh',
    })
  })

  it('PATCH /api/projects/[projectId]/edit-script -> moves adjacent video block boundary shots and rewrites affected prompts', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script',
      method: 'PATCH',
      headers: { 'accept-language': 'zh' },
      body: {
        operation: 'arrangeVideoBlocks',
        episodeId: 'episode-1',
        editScriptId: 'edit-1',
        blocks: [
          { shotNumbers: [1, 2, 3] },
          { shotNumbers: [4] },
        ],
      },
    })

    const response = await editScriptPatch(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.editScript.videoBlocks[0].shotNumbers).toEqual([1, 2, 3])
    expect(videoBlockArrangementMock.arrangeProjectEditScriptVideoBlocks).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blocks: [
        { shotNumbers: [1, 2, 3] },
        { shotNumbers: [4] },
      ],
      userId: 'user-1',
      locale: 'zh',
    })
  })

  it('PATCH /api/projects/[projectId]/edit-script -> updates one required asset prompt', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/edit-script',
      method: 'PATCH',
      body: {
        episodeId: 'episode-1',
        editScriptId: 'edit-1',
        requirementId: 'req-1',
        description: 'updated asset prompt',
      },
    })

    const response = await editScriptPatch(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.editScript.requirements[0].description).toBe('updated asset prompt')
    expect(serviceMock.updateProjectEditScriptAssetRequirementDescription).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      requirementId: 'req-1',
      description: 'updated asset prompt',
    })
  })
})
