import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectEpisode: {
    findFirst: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
  },
  projectEditScreenplay: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

const submitOperationTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/operations/submit-operation-task', () => ({
  submitOperationTask: submitOperationTaskMock,
}))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
  })),
}))

import {
  submitProjectEditScreenplayGenerationTask,
  submitProjectEditScreenplayRevisionTask,
} from '@/lib/edit-script/task-submission'

function request(): NextRequest {
  return new Request('http://localhost/api/projects/project-1/edit-script/screenplay', {
    method: 'POST',
    headers: { 'accept-language': 'zh' },
  }) as unknown as NextRequest
}

function mockSubmitResult(taskId: string) {
  return {
    success: true,
    async: true,
    taskId,
    runId: null,
    status: 'queued',
    deduped: false,
  }
}

describe('edit screenplay task submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.projectEditScreenplay.findUnique.mockResolvedValue(null)
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValue({
      id: 'screenplay-1',
      status: 'screenplay_ready',
    })
    prismaMock.projectEditScreenplay.create.mockResolvedValue({ id: 'screenplay-pending-1' })
    prismaMock.projectEditScreenplay.update.mockResolvedValue({ id: 'screenplay-1' })
    prismaMock.projectEditScreenplay.deleteMany.mockResolvedValue({ count: 1 })
    submitOperationTaskMock.mockResolvedValue(mockSubmitResult('task-screenplay-1'))
  })

  it('creates a stable ProjectEditScreenplay pending target before submitting generation', async () => {
    const result = await submitProjectEditScreenplayGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      prompt: '生成一部恐怖短片',
      durationTier: 'short',
      aspectRatio: '16:9',
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-screenplay-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-pending-1',
      taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: 'screenplay-pending-1',
    }))
    expect(prismaMock.projectEditScreenplay.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: expect.stringContaining('生成一部恐怖短片'),
        screenplayText: '',
        status: 'generating',
      }),
      select: { id: true },
    })
    expect(submitOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: 'screenplay-pending-1',
      operationId: 'generate_edit_screenplay',
      dedupeKey: 'edit_screenplay_generate:project-1:episode-1',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        screenplayId: 'screenplay-pending-1',
        prompt: '生成一部恐怖短片',
        durationTier: 'short',
        aspectRatio: '16:9',
        analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
        maxInputTokens: 12_000,
      }),
    }))
    expect(prismaMock.projectEditScreenplay.create.mock.invocationCallOrder[0])
      .toBeLessThan(submitOperationTaskMock.mock.invocationCallOrder[0])
  })

  it('removes a newly-created pending screenplay when task submit fails', async () => {
    submitOperationTaskMock.mockRejectedValueOnce(new Error('queue unavailable'))

    await expect(submitProjectEditScreenplayGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      prompt: '生成一部恐怖短片',
      durationTier: 'short',
      aspectRatio: '16:9',
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
    })).rejects.toThrow('queue unavailable')

    expect(prismaMock.projectEditScreenplay.deleteMany).toHaveBeenCalledWith({
      where: { id: 'screenplay-pending-1' },
    })
  })

  it('restores an existing screenplay snapshot when task submit fails after marking it generating', async () => {
    prismaMock.projectEditScreenplay.findUnique.mockResolvedValueOnce({
      id: 'screenplay-1',
      userPrompt: 'old prompt',
      styleBibleJson: { style: 'old' },
      screenplayText: 'old screenplay',
      status: 'screenplay_ready',
    })
    submitOperationTaskMock.mockRejectedValueOnce(new Error('queue unavailable'))

    await expect(submitProjectEditScreenplayGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      prompt: '生成一部恐怖短片',
      durationTier: 'short',
      aspectRatio: '16:9',
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
    })).rejects.toThrow('queue unavailable')

    expect(prismaMock.projectEditScreenplay.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'screenplay-1' },
      data: expect.objectContaining({
        userPrompt: expect.stringContaining('生成一部恐怖短片'),
        status: 'generating',
      }),
      select: { id: true },
    })
    expect(prismaMock.projectEditScreenplay.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'screenplay-1' },
      data: expect.objectContaining({
        userPrompt: 'old prompt',
        screenplayText: 'old screenplay',
        status: 'screenplay_ready',
      }),
    })
  })

  it('rejects revision before screenplay review state and does not submit a task', async () => {
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValueOnce({
      id: 'screenplay-1',
      status: 'generating',
    })

    await expect(submitProjectEditScreenplayRevisionTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
      revisionInstruction: '更黑暗一些',
      durationTier: 'short',
      aspectRatio: '16:9',
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
    })).rejects.toThrow('Edit screenplay can only be revised during screenplay review')

    expect(submitOperationTaskMock).not.toHaveBeenCalled()
  })
})
