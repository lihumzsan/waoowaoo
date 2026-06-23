import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import type {
  WorkflowLabCheckpointListResult,
  WorkflowLabCheckpointSummary,
  WorkflowLabEpisodeSummary,
  WorkflowLabForkResult,
} from '@/lib/workflow-lab/types'
import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const workflowLabServiceMock = vi.hoisted(() => ({
  isWorkflowLabEnabled: vi.fn(),
  listWorkflowLabCheckpoints: vi.fn(),
  forkWorkflowLabCheckpointProject: vi.fn(),
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

const sampleCheckpoint: WorkflowLabCheckpointSummary = {
  id: 'choice:1:0:edit-first-style',
  sourceEpisodeId: 'episode-1',
  kind: 'choice',
  workflowStage: 'needs_style_choice',
  title: 'Choose Visual Style',
  detail: 'Choose one candidate.',
  choiceType: 'style',
  operationId: EDIT_FIRST_CHOICE_TOOL_IDS.style,
  messageIndex: 1,
  partIndex: 0,
  assistantMessageCount: 2,
}

const sampleListResult: WorkflowLabCheckpointListResult = {
  sourceEpisode: sampleEpisode,
  checkpoints: [sampleCheckpoint],
}

describe('api contract - workflow lab route', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
    workflowLabServiceMock.isWorkflowLabEnabled.mockReturnValue(true)
    workflowLabServiceMock.listWorkflowLabCheckpoints.mockResolvedValue(sampleListResult)
    workflowLabServiceMock.forkWorkflowLabCheckpointProject.mockResolvedValue({
      checkpoint: sampleCheckpoint,
      sourceProject: { id: 'project-1', name: 'Project' },
      sourceEpisode: sampleEpisode,
      labProject: { id: 'project-lab', name: '[LAB] Project' },
      labEpisode: {
        ...sampleEpisode,
        id: 'episode-lab',
        episodeNumber: 1,
      },
    } satisfies WorkflowLabForkResult)
  })

  it('GET returns real assistant checkpoints for the authenticated episode', async () => {
    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'GET',
        query: { episodeId: 'episode-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(workflowLabServiceMock.listWorkflowLabCheckpoints).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      sourceEpisodeId: 'episode-1',
    })
    await expect(res.json()).resolves.toEqual({
      enabled: true,
      sourceEpisode: sampleEpisode,
      checkpoints: [sampleCheckpoint],
      currentEpisodeId: 'episode-1',
    })
  })

  it('GET rejects enabled lab requests without an episode id', async () => {
    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(400)
    expect(workflowLabServiceMock.listWorkflowLabCheckpoints).not.toHaveBeenCalled()
  })

  it('GET reports disabled mode without listing checkpoints', async () => {
    workflowLabServiceMock.isWorkflowLabEnabled.mockReturnValue(false)

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(workflowLabServiceMock.listWorkflowLabCheckpoints).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toEqual({
      enabled: false,
      sourceEpisode: null,
      checkpoints: [],
      currentEpisodeId: null,
    })
  })

  it('POST forks a checkpoint into a new lab project through the service', async () => {
    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'POST',
        body: {
          action: 'forkCheckpointProject',
          sourceEpisodeId: 'episode-1',
          checkpointId: sampleCheckpoint.id,
          name: 'Fork Name',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(workflowLabServiceMock.forkWorkflowLabCheckpointProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      sourceEpisodeId: 'episode-1',
      checkpointId: sampleCheckpoint.id,
      name: 'Fork Name',
    })
    await expect(res.json()).resolves.toEqual({
      success: true,
      result: {
        checkpoint: sampleCheckpoint,
        sourceProject: { id: 'project-1', name: 'Project' },
        sourceEpisode: sampleEpisode,
        labProject: { id: 'project-lab', name: '[LAB] Project' },
        labEpisode: {
          ...sampleEpisode,
          id: 'episode-lab',
          episodeNumber: 1,
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
          action: 'forkEpisode',
          sourceEpisodeId: 'episode-1',
          checkpointId: sampleCheckpoint.id,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(400)
    expect(workflowLabServiceMock.forkWorkflowLabCheckpointProject).not.toHaveBeenCalled()
  })

  it('POST requires checkpoint id before forking', async () => {
    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'POST',
        body: {
          action: 'forkCheckpointProject',
          sourceEpisodeId: 'episode-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(400)
    expect(workflowLabServiceMock.forkWorkflowLabCheckpointProject).not.toHaveBeenCalled()
  })

  it('returns auth error before touching workflow lab service', async () => {
    authState.authenticated = false

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-lab',
        method: 'GET',
        query: { episodeId: 'episode-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(401)
    expect(workflowLabServiceMock.listWorkflowLabCheckpoints).not.toHaveBeenCalled()
  })
})
