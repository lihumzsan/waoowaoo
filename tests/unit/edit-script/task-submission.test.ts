import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectEditBible: {
    findFirst: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
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
    storyboardModel: 'fal::gpt-image-2',
  })),
}))

import { submitProjectEditStylePreviewsGenerationTask } from '@/lib/edit-script/task-submission'

function request(): NextRequest {
  return new Request('http://localhost/api/projects/project-1/bible/style-preview', {
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

describe('edit style preview task submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEditBible.findFirst.mockResolvedValue({
      id: 'bible-1',
      status: 'confirmed',
    })
    prismaMock.task.findFirst.mockResolvedValue(null)
    submitOperationTaskMock.mockResolvedValue(mockSubmitResult('task-style-parent-1'))
  })

  it('submits visual style generation against ProjectEditBible', async () => {
    const result = await submitProjectEditStylePreviewsGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      bibleId: 'bible-1',
      styleDirection: '更黑暗一些',
      count: 2,
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      taskId: 'task-style-parent-1',
      episodeId: 'episode-1',
      bibleId: 'bible-1',
      taskType: TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
    }))
    expect(submitOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
      operationId: 'generate_edit_style_previews',
      dedupeKey: 'edit_style_previews_generate:project-1:bible-1',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        bibleId: 'bible-1',
        styleDirection: '更黑暗一些',
        count: 2,
        analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
        maxInputTokens: 12_000,
      }),
    }))
  })

  it('rejects style preview generation until the Bible is confirmed', async () => {
    prismaMock.projectEditBible.findFirst.mockResolvedValueOnce({
      id: 'bible-1',
      status: 'ready_for_review',
    })

    await expect(submitProjectEditStylePreviewsGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      bibleId: 'bible-1',
      source: 'project-ui',
      confirmed: true,
      locale: 'zh',
    })).rejects.toThrow('Edit Bible must be confirmed before style preview generation')

    expect(submitOperationTaskMock).not.toHaveBeenCalled()
  })
})
