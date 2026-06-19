import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import type { WorkflowLabEpisodeSummary, WorkflowLabForkResult } from '@/lib/workflow-lab/types'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const workflowLabServiceMock = vi.hoisted(() => ({
  isWorkflowLabEnabled: vi.fn(),
  listWorkflowLabEpisodes: vi.fn(),
  forkWorkflowLabEpisode: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireProjectAuth: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1', name: 'Project' },
      }
    },
  }
})

vi.mock('@/lib/workflow-lab/service', () => workflowLabServiceMock)

import { GET, POST } from '@/app/api/projects/[projectId]/workflow-lab/route'

const sampleEpisode: WorkflowLabEpisodeSummary = {
  id: 'episode-1',
  name: 'Episode 1',
  episodeNumber: 1,
  workflowStage: 'needs_style_choice',
  blockingKind: 'needs_user_choice',
  blockingReason: null,
  nextOperationId: null,
  allowedOperationIds: ['generate_edit_style_previews'],
}

describe('api contract - workflow lab route', () => {
  beforeEach(() => {
    authState.authenticated = true
    workflowLabServiceMock.isWorkflowLabEnabled.mockReturnValue(true)
    workflowLabServiceMock.listWorkflowLabEpisodes.mockResolvedValue([sampleEpisode])
    workflowLabServiceMock.forkWorkflowLabEpisode.mockResolvedValue({
      sourceEpisode: sampleEpisode,
      forkedEpisode: {
        ...sampleEpisode,
        id: 'episode-forked',
        name: '[LAB] Episode 1',
        episodeNumber: 2,
      },
    } satisfies WorkflowLabForkResult)
    vi.clearAllMocks()
    workflowLabServiceMock.isWorkflowLabEnabled.mockReturnValue(true)
  })

  it('GET returns real workflow lab episodes for the authenticated project', async () => {
    workflowLabServiceMock.listWorkflowLabEpisodes.mockResolvedValueOnce([sampleEpisode])

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'GET',
        query: { episodeId: 'episode-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(workflowLabServiceMock.listWorkflowLabEpisodes).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
    })
    await expect(res.json()).resolves.toEqual({
      enabled: true,
      episodes: [sampleEpisode],
      currentEpisodeId: 'episode-1',
    })
  })

  it('GET reports disabled mode without listing episodes', async () => {
    workflowLabServiceMock.isWorkflowLabEnabled.mockReturnValue(false)

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(workflowLabServiceMock.listWorkflowLabEpisodes).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toEqual({
      enabled: false,
      episodes: [],
      currentEpisodeId: null,
    })
  })

  it('POST forks a source episode through the workflow lab service', async () => {
    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'POST',
        body: {
          action: 'forkEpisode',
          sourceEpisodeId: 'episode-1',
          name: 'Fork Name',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(workflowLabServiceMock.forkWorkflowLabEpisode).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      sourceEpisodeId: 'episode-1',
      name: 'Fork Name',
    })
    await expect(res.json()).resolves.toEqual({
      success: true,
      result: {
        sourceEpisode: sampleEpisode,
        forkedEpisode: {
          ...sampleEpisode,
          id: 'episode-forked',
          name: '[LAB] Episode 1',
          episodeNumber: 2,
        },
      },
    })
  })

  it('POST rejects invalid action before forking', async () => {
    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'POST',
        body: {
          action: 'switchStage',
          sourceEpisodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(400)
    expect(workflowLabServiceMock.forkWorkflowLabEpisode).not.toHaveBeenCalled()
  })

  it('returns auth error before touching workflow lab service', async () => {
    authState.authenticated = false

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(401)
    expect(workflowLabServiceMock.listWorkflowLabEpisodes).not.toHaveBeenCalled()
  })
})
