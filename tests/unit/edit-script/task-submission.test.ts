import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectEditBible: {
    findFirst: vi.fn(),
  },
  projectEditScript: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  projectEditChapter: {
    findFirst: vi.fn(),
  },
  projectEditShotExecutionPlan: {
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

import {
  submitProjectEditShotExecutionPlanTask,
  submitProjectEditShotExecutionPlanBatchTasks,
  submitProjectEditStylePreviewsGenerationTask,
} from '@/lib/edit-script/task-submission'

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

describe('edit shot execution plan task submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.projectEditShotExecutionPlan.findFirst.mockResolvedValue(null)
    prismaMock.projectEditChapter.findFirst.mockImplementation(async (input: { readonly where: { readonly id: string } }) => ({
      id: input.where.id,
    }))
  })

  it('submits a batch only for episode edit scripts missing a ready shot execution plan', async () => {
    prismaMock.projectEditScript.findMany.mockResolvedValue([
      {
        id: 'script-ready',
        episodeId: 'episode-1',
        chapterId: 'chapter-ready',
        shotExecutionPlan: { status: 'ready' },
      },
      {
        id: 'script-missing',
        episodeId: 'episode-1',
        chapterId: 'chapter-missing',
        shotExecutionPlan: null,
      },
      {
        id: 'script-failed',
        episodeId: 'episode-1',
        chapterId: 'chapter-failed',
        shotExecutionPlan: { status: 'failed' },
      },
    ])
    prismaMock.projectEditScript.findFirst
      .mockResolvedValueOnce({
        id: 'script-missing',
        episodeId: 'episode-1',
        chapterId: 'chapter-missing',
        status: 'ready',
        requirements: [],
      })
      .mockResolvedValueOnce({
        id: 'script-failed',
        episodeId: 'episode-1',
        chapterId: 'chapter-failed',
        status: 'ready',
        requirements: [],
      })
    submitOperationTaskMock
      .mockResolvedValueOnce(mockSubmitResult('task-missing'))
      .mockResolvedValueOnce(mockSubmitResult('task-failed'))

    const submittedTaskIds: string[] = []
    const result = await submitProjectEditShotExecutionPlanBatchTasks({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      source: 'project-agent',
      confirmed: true,
      locale: 'zh',
      onSubmittedTask: (taskId) => {
        submittedTaskIds.push(taskId)
      },
    })

    expect(prismaMock.projectEditScript.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        status: 'ready',
      },
    }))
    expect(submitOperationTaskMock).toHaveBeenCalledTimes(2)
    expect(submitOperationTaskMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: 'script-missing',
      operationId: 'generate_edit_shot_execution_plan',
      dedupeKey: 'edit_shot_execution_plan_generate:project-1:script-missing',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        chapterId: 'chapter-missing',
        editScriptId: 'script-missing',
        displayMode: 'detail',
      }),
    }))
    expect(submitOperationTaskMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      targetId: 'script-failed',
      dedupeKey: 'edit_shot_execution_plan_generate:project-1:script-failed',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      payload: expect.objectContaining({
        chapterId: 'chapter-failed',
        editScriptId: 'script-failed',
      }),
    }))
    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      episodeId: 'episode-1',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      total: 2,
      taskIds: ['task-missing', 'task-failed'],
    }))
    expect(result.results).toEqual([
      expect.objectContaining({
        refId: 'script-missing',
        taskId: 'task-missing',
        targetId: 'script-missing',
      }),
      expect.objectContaining({
        refId: 'script-failed',
        taskId: 'task-failed',
        targetId: 'script-failed',
      }),
    ])
    expect(submittedTaskIds).toEqual(['task-missing', 'task-failed'])
  })

  it('rejects a single shot execution plan task when the edit script already has a ready plan', async () => {
    prismaMock.projectEditScript.findFirst.mockResolvedValue({
      id: 'script-ready',
      episodeId: 'episode-1',
      chapterId: 'chapter-ready',
      status: 'ready',
      requirements: [],
    })
    prismaMock.projectEditShotExecutionPlan.findFirst.mockResolvedValue({
      id: 'plan-ready',
    })

    await expect(submitProjectEditShotExecutionPlanTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-ready',
      editScriptId: 'script-ready',
      source: 'assistant-panel',
      confirmed: true,
      locale: 'zh',
    })).rejects.toThrow('Shot execution plan is already ready for this edit script.')

    expect(prismaMock.projectEditShotExecutionPlan.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        editScriptId: 'script-ready',
        status: 'ready',
      },
      select: { id: true },
    })
    expect(submitOperationTaskMock).not.toHaveBeenCalled()
  })

  it('fails explicitly when no episode edit scripts need shot execution planning', async () => {
    prismaMock.projectEditScript.findMany.mockResolvedValue([
      {
        id: 'script-ready',
        episodeId: 'episode-1',
        chapterId: 'chapter-ready',
        shotExecutionPlan: { status: 'ready' },
      },
    ])

    await expect(submitProjectEditShotExecutionPlanBatchTasks({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      source: 'project-agent',
      confirmed: true,
      locale: 'zh',
    })).rejects.toThrow('No edit scripts require shot execution plan generation.')

    expect(submitOperationTaskMock).not.toHaveBeenCalled()
  })
})
