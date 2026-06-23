import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectStoryboard: {
    findMany: vi.fn(),
  },
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(),
}))

const sourceSnapshotMock = vi.hoisted(() => ({
  buildStoryboardConsistencySource: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/edit-script/storyboard-consistency/source-snapshot', () => sourceSnapshotMock)
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
  })),
}))

import {
  submitEditScriptSpatialBlockingStoryboard,
  submitEditScriptStoryboardPanels,
} from '@/lib/edit-script/storyboard-consistency/service'

describe('edit-script storyboard panel service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEditScript.findFirst.mockResolvedValue({ id: 'edit-1' })
    prismaMock.projectStoryboard.findMany.mockResolvedValue([])
    submitterMock.submitTask.mockResolvedValue({
      success: true,
      async: true,
      taskId: 'task-1',
      status: 'queued',
      deduped: false,
      runId: null,
    })
    sourceSnapshotMock.buildStoryboardConsistencySource.mockResolvedValue({
      sourceSnapshot: {
        schemaVersion: 1,
        shots: [{ shotNumber: 1 }],
      },
      modelConfigSnapshot: {
        analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
        storyboardModel: 'fal::gpt-image-2',
      },
    })
  })

  it('reports missing storyboard spatial blocking instead of missing location profiles', async () => {
    await expect(submitEditScriptStoryboardPanels({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      userId: 'user-1',
      locale: 'zh',
    })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'CONFLICT',
      details: {
        code: 'STORYBOARD_SPATIAL_BLOCKING_REQUIRED',
        message: 'Ready storyboard spatial blocking is required before generating storyboard panels',
      },
    })

    expect(sourceSnapshotMock.buildStoryboardConsistencySource).not.toHaveBeenCalled()
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('submits spatial blocking with text billing model fields', async () => {
    const result = await submitEditScriptSpatialBlockingStoryboard({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      userId: 'user-1',
      locale: 'zh',
      requestId: 'request-1',
    })

    expect(result).toEqual(expect.objectContaining({
      taskId: 'task-1',
      editScriptId: 'edit-1',
    }))
    expect(submitterMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEditScript',
      targetId: 'edit-1',
      operationId: 'generate_edit_script_storyboard_spatial_blocking',
      payload: expect.objectContaining({
        editScriptId: 'edit-1',
        count: 1,
        analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
        maxInputTokens: 12_000,
      }),
    }))
  })

  it('submits storyboard panels with text billing model fields', async () => {
    prismaMock.projectStoryboard.findMany.mockResolvedValueOnce([{
      id: 'storyboard-1',
      photographyPlan: JSON.stringify({
        sourceEditScriptId: 'edit-1',
        currentStage: 'spatial_profile_ready',
      }),
    }])

    const result = await submitEditScriptStoryboardPanels({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      userId: 'user-1',
      locale: 'zh',
      requestId: 'request-1',
    })

    expect(result).toEqual(expect.objectContaining({
      taskId: 'task-1',
      storyboardId: 'storyboard-1',
    }))
    expect(submitterMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectStoryboard',
      targetId: 'storyboard-1',
      operationId: 'generate_edit_script_storyboard',
      payload: expect.objectContaining({
        editScriptId: 'edit-1',
        storyboardId: 'storyboard-1',
        analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
        maxInputTokens: 12_000,
      }),
    }))
  })
})
